"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./download-client.module.css";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { CodeTag } from "@/components/ui/code-tag";
import { Meter } from "@/components/ui/meter";
import { formatBytes, formatDate, formatRelative } from "@/lib/format";
import { b64uToBytes, decodeFragment } from "@/lib/crypto/encode";
import { importFileKey } from "@/lib/crypto/file-key";
import { decryptStream } from "@/lib/crypto/stream";
import { decryptManifest, type Manifest } from "@/lib/crypto/manifest";
import { deriveKey, type KdfParams } from "@/lib/crypto/argon";
import { importPasswordDerivedKey, unwrapKey } from "@/lib/crypto/wrap";
import {
  BLOB_FALLBACK_MAX_BYTES,
  StreamingUnsupportedError,
  hasFileSystemAccess,
  saveBlobFromStream,
  saveStream,
} from "@/lib/save-stream";
import { resumableFetch } from "@/lib/resume-fetch";
import { downloadZip } from "client-zip";

type TransferMeta = {
  id: string;
  state: "ready" | "expired" | "revoked" | "exhausted";
  fileCount: number;
  totalBytes: number;
  expiresAt: string;
  hasPassword: boolean;
  downloadsRemaining: number | null;
  passwordBundle?: {
    salt: string;
    wrappedKey: string;
    kdfParams: KdfParams;
  };
};

type DownloadUrls = {
  manifestUrl: string;
  files: { fileIndex: number; url: string }[];
  resumeToken?: string;
};

type UiPhase =
  | "loading-meta"
  | "missing-fragment"
  | "password-required"
  | "deriving-password"
  | "fetching-manifest"
  | "ready"
  | "downloading"
  | "done"
  | "expired"
  | "revoked"
  | "exhausted"
  | "error";

export function DownloadClient({ id }: { id: string }) {
  const [phase, setPhase] = useState<UiPhase>("loading-meta");
  const [meta, setMeta] = useState<TransferMeta | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [fileKey, setFileKey] = useState<CryptoKey | null>(null);
  const [urls, setUrls] = useState<DownloadUrls | null>(null);
  const [passwordInput, setPasswordInput] = useState("");
  const [pwError, setPwError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [canStream, setCanStream] = useState<boolean | null>(null);

  useEffect(() => {
    setCanStream(hasFileSystemAccess());
  }, []);

  useEffect(() => {
    let cancelled = false;

    const hash = typeof window !== "undefined" ? window.location.hash : "";

    (async () => {
      try {
        const res = await fetch(`/api/transfers/${id}`, { cache: "no-store" });
        if (res.status === 404) {
          if (!cancelled) setPhase("expired");
          return;
        }
        if (!res.ok) throw new Error(`Metadata fetch failed (${res.status})`);
        const data = (await res.json()) as TransferMeta;
        if (cancelled) return;
        setMeta(data);
        if (data.state === "expired") {
          setPhase("expired");
          return;
        }
        if (data.state === "revoked") {
          setPhase("revoked");
          return;
        }
        if (data.state === "exhausted") {
          setPhase("exhausted");
          return;
        }
        if (data.hasPassword) {
          setPhase("password-required");
          return;
        }
        if (!hash) {
          setPhase("missing-fragment");
          return;
        }
        let extractedKey: Uint8Array;
        try {
          extractedKey = decodeFragment(hash);
        } catch {
          setPhase("missing-fragment");
          return;
        }
        const key = await importFileKey(extractedKey);
        if (cancelled) return;
        setFileKey(key);
        await loadManifest(id, key, setStatusText, setManifest, setUrls);
        if (!cancelled) setPhase("ready");
      } catch (err) {
        if (!cancelled) {
          setPhase("error");
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  async function tryPassword() {
    if (!meta?.passwordBundle) return;
    setPhase("deriving-password");
    setPwError(false);
    setStatusText("Deriving password key…");
    try {
      const saltBytes = b64uToBytes(meta.passwordBundle.salt);
      const wrappedBytes = b64uToBytes(meta.passwordBundle.wrappedKey);
      const derivedBytes = await deriveKey(
        passwordInput,
        saltBytes,
        meta.passwordBundle.kdfParams,
      );
      const pwKey = await importPasswordDerivedKey(derivedBytes);
      let unwrapped: Uint8Array;
      try {
        unwrapped = await unwrapKey(wrappedBytes, pwKey);
      } catch {
        setPwError(true);
        setPhase("password-required");
        return;
      }
      const key = await importFileKey(unwrapped);
      setFileKey(key);
      setPhase("fetching-manifest");
      await loadManifest(id, key, setStatusText, setManifest, setUrls);
      setPhase("ready");
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : "Decryption failed.");
    }
  }

  async function startDownload() {
    if (!fileKey || !manifest || !urls) return;
    const totalBytes = manifest.files.reduce((n, f) => n + f.size, 0);
    const streaming = hasFileSystemAccess();

    if (!streaming && totalBytes > BLOB_FALLBACK_MAX_BYTES) {
      setPhase("error");
      setError(
        `This browser buffers downloads in memory (${formatBytes(
          BLOB_FALLBACK_MAX_BYTES,
        )} max). This transfer is ${formatBytes(
          totalBytes,
        )} — open the link in Chrome or Edge to download it.`,
      );
      return;
    }

    setPhase("downloading");
    setProgress(0);
    setStatusText("Decrypting…");
    let written = 0;
    const onBytes = (n: number) => {
      written += n;
      setProgress((written / totalBytes) * 100);
    };

    // Keep a mutable view of the latest presigned URLs; refreshed on retry
    // if the server hands us updated ones for the same session.
    let currentUrls = urls;
    const urlFor = (i: number): string => {
      const entry = currentUrls.files.find((f) => f.fileIndex === i);
      if (!entry) throw new Error(`missing url for file ${i}`);
      return entry.url;
    };

    // Refresh presigned URLs mid-download by re-calling /download with the
    // existing resumeToken. Server re-mints URLs without incrementing the
    // counter. Called lazily when a retry suspects the URL expired (15m
    // presign TTL — plenty, but a multi-hour download past TTL must be able
    // to recover).
    let lastRefresh = Date.now();
    const maybeRefreshUrls = async (): Promise<void> => {
      // Skip if URLs were minted <10 min ago; they're valid for ~1h total.
      if (Date.now() - lastRefresh < 10 * 60 * 1000) return;
      const res = await fetch(`/api/transfers/${id}/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resumeToken: currentUrls.resumeToken,
        }),
      });
      if (!res.ok) return; // best-effort; fall through to retry the old URL
      currentUrls = (await res.json()) as DownloadUrls;
      lastRefresh = Date.now();
    };

    const decryptedFor = (i: number): ReadableStream<Uint8Array> => {
      const ciphertext = resumableFetch({
        urlProvider: async () => {
          await maybeRefreshUrls();
          return urlFor(i);
        },
        onRetry: ({ attempt, bytesReceived }) => {
          setStatusText(
            `Reconnecting (attempt ${attempt}) from ${formatBytes(
              bytesReceived,
            )}…`,
          );
        },
      });
      return decryptStream(fileKey, ciphertext);
    };

    const buildStream = (): ReadableStream<Uint8Array> => {
      if (manifest.files.length === 1) {
        return decryptedFor(0);
      }
      const entries = manifest.files.map((mf, i) => ({
        name: mf.name,
        lastModified: new Date(),
        input: decryptedFor(i),
      }));
      const zipStream = downloadZip(entries).body;
      if (!zipStream) throw new Error("zip stream unavailable");
      return zipStream;
    };

    const filename =
      manifest.files.length === 1
        ? manifest.files[0].name
        : `filetransfer-${id}.zip`;

    const saveWithFallback = async () => {
      if (streaming) {
        try {
          await saveStream(buildStream(), filename, onBytes);
          return;
        } catch (err) {
          if (!(err instanceof StreamingUnsupportedError)) throw err;
          // Browser lied about FS Access support (e.g. Samsung Internet).
          // Fall through to blob save, enforcing the size cap.
          if (totalBytes > BLOB_FALLBACK_MAX_BYTES) {
            throw new Error(
              `This browser doesn't support streaming downloads and this transfer is too large (${formatBytes(
                totalBytes,
              )}). Open the link in Chrome or Edge, or ask the sender to split the transfer.`,
            );
          }
          // Reset progress — first attempt may have written some before failing.
          written = 0;
          setProgress(0);
          setStatusText("Falling back to in-memory download…");
        }
      }
      await saveBlobFromStream(buildStream(), filename, onBytes);
    };

    try {
      await saveWithFallback();
      setStatusText("Done.");
      setPhase("done");
    } catch (err) {
      setPhase("error");
      // Don't pretend every failure is a tamper — surface the real message
      // and only blame the ciphertext for OperationError (GCM auth fail).
      const msg = err instanceof Error ? err.message : "Download failed.";
      const isTamper =
        err instanceof Error && err.name === "OperationError";
      setError(
        isTamper
          ? `Couldn't decrypt — the file may be tampered or incomplete (${msg})`
          : msg,
      );
    }
  }

  return (
    <div className={styles.grid}>
      <div className={styles.main}>
        <div className={styles.idLine}>
          01 — RECEIVE · id <CodeTag>{id}</CodeTag>
        </div>

        {phase === "loading-meta" && (
          <Card>
            <p className="small">Loading…</p>
          </Card>
        )}

        {phase === "missing-fragment" && (
          <Card>
            <div className={styles.expired}>
              <h1 className={styles.headline} style={{ color: "var(--ink)" }}>
                Link incomplete.
              </h1>
              <p>
                The <CodeTag>#</CodeTag> part of the URL is missing or
                malformed. Decryption isn&apos;t possible without it. Ask the
                sender for the full link.
              </p>
            </div>
          </Card>
        )}

        {phase === "expired" && (
          <Card>
            <div className={styles.expired}>
              <h1 className={styles.headline} style={{ color: "var(--ink)" }}>
                This link expired.
              </h1>
              <p>
                {meta &&
                  `Expired on ${formatDate(new Date(meta.expiresAt))}. `}
                Contents have been removed from storage.
              </p>
              <div>
                <Link href="/">
                  <Button variant="secondary" size="sm">
                    Send a new file →
                  </Button>
                </Link>
              </div>
            </div>
          </Card>
        )}

        {phase === "revoked" && (
          <Card>
            <div className={styles.expired}>
              <h1 className={styles.headline} style={{ color: "var(--ink)" }}>
                This link was revoked.
              </h1>
              <p>The sender removed this transfer.</p>
            </div>
          </Card>
        )}

        {phase === "exhausted" && (
          <Card>
            <div className={styles.expired}>
              <h1 className={styles.headline} style={{ color: "var(--ink)" }}>
                Download limit reached.
              </h1>
              <p>
                This link has already been downloaded the maximum number of
                times.
              </p>
            </div>
          </Card>
        )}

        {(phase === "password-required" || phase === "deriving-password") && (
          <Card>
            <div className={styles.pwWrap}>
              <h1 className={styles.headline}>Password required.</h1>
              <p className="small">
                This transfer is locked. The password wraps the encryption key
                — we can&apos;t recover it for you.
              </p>
              <Field
                label="Password"
                error={
                  pwError ? "Couldn't decrypt — check the password." : undefined
                }
              >
                <Input
                  type="password"
                  autoFocus
                  placeholder="Enter password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") tryPassword();
                  }}
                  disabled={phase === "deriving-password"}
                />
              </Field>
              <div style={{ marginTop: 4 }}>
                <Button
                  type="button"
                  onClick={tryPassword}
                  disabled={phase === "deriving-password" || !passwordInput}
                >
                  {phase === "deriving-password"
                    ? "Deriving key…"
                    : "Unlock →"}
                </Button>
              </div>
            </div>
          </Card>
        )}

        {(phase === "ready" || phase === "downloading" || phase === "done") &&
          manifest && (
            <>
              <h1 className={styles.headline}>
                Someone sent you{" "}
                <span className="accent tnum">
                  {manifest.files.length} file
                  {manifest.files.length === 1 ? "" : "s"}
                </span>
                .
              </h1>
              {manifest.message && (
                <p className={styles.message}>{manifest.message}</p>
              )}
              <Card>
                {manifest.files.map((f) => (
                  <div key={f.name} className={styles.fileRow}>
                    <span className={styles.fileName}>{f.name}</span>
                    <span className={styles.fileSize}>
                      {formatBytes(f.size)}
                    </span>
                  </div>
                ))}
                <div className={styles.totalRow}>
                  <span>Total</span>
                  <span className="tnum" style={{ color: "var(--ink)" }}>
                    {formatBytes(
                      manifest.files.reduce((n, f) => n + f.size, 0),
                    )}
                  </span>
                </div>
                {phase === "downloading" && (
                  <Meter
                    value={progress}
                    label={statusText}
                    rightLabel={`${progress.toFixed(0)}%`}
                  />
                )}
                {canStream === false && phase === "ready" && (
                  <p
                    style={{
                      fontSize: 13,
                      color: "var(--ink-muted)",
                      borderLeft: "2px solid var(--rule-strong)",
                      paddingLeft: "var(--s-3)",
                      margin: 0,
                    }}
                  >
                    This browser buffers downloads in memory. For files over{" "}
                    {formatBytes(BLOB_FALLBACK_MAX_BYTES)}, open this link in
                    Chrome or Edge.
                  </p>
                )}
                <div className={styles.actions}>
                  <span className="small tnum">
                    {meta &&
                      `expires ${formatRelative(new Date(meta.expiresAt))}`}
                  </span>
                  {phase === "done" ? (
                    <span className="small accent">Saved.</span>
                  ) : (
                    <Button
                      onClick={startDownload}
                      disabled={phase === "downloading"}
                    >
                      {phase === "downloading"
                        ? "Decrypting…"
                        : "Decrypt & download →"}
                    </Button>
                  )}
                </div>
              </Card>
            </>
          )}

        {phase === "error" && (
          <Card>
            <div className={styles.expired}>
              <h1 className={styles.headline} style={{ color: "var(--ink)" }}>
                Something went wrong.
              </h1>
              <p>{error}</p>
            </div>
          </Card>
        )}
      </div>

      <aside className={styles.rail}>
        <div className={styles.railHead}>
          <Chip tone="accent">E2E</Chip>
          <Chip tone="muted">AES-256-GCM</Chip>
        </div>
        <p>
          The decryption key is in the <CodeTag>#</CodeTag> part of this URL.
          Our servers never received it.
        </p>
        <p>
          Decryption happens here, in your browser. If the URL is incomplete or
          tampered with, decryption will fail.
        </p>
      </aside>
    </div>
  );
}

async function loadManifest(
  id: string,
  fileKey: CryptoKey,
  setStatus: (s: string) => void,
  setManifest: (m: Manifest) => void,
  setUrls: (u: DownloadUrls) => void,
): Promise<void> {
  setStatus("Fetching manifest…");
  const res = await fetch(`/api/transfers/${id}/download`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) {
    if (res.status === 410) throw new Error("Link no longer available");
    throw new Error(`Download init failed (${res.status})`);
  }
  const urls = (await res.json()) as DownloadUrls;
  setUrls(urls);
  const manifestRes = await fetch(urls.manifestUrl);
  if (!manifestRes.ok) throw new Error("Manifest fetch failed");
  const blob = new Uint8Array(await manifestRes.arrayBuffer());
  const manifest = await decryptManifest(fileKey, blob);
  setManifest(manifest);
}

