"use client";

import { useCallback, useRef, useState } from "react";
import { generateFileKey } from "@/lib/crypto/file-key";
import { bytesToB64u, encodeFragment } from "@/lib/crypto/encode";
import {
  chunkCount,
  encryptStream,
  expectedCiphertextSize,
} from "@/lib/crypto/stream";
import { encryptManifest, type Manifest } from "@/lib/crypto/manifest";
import {
  DEFAULT_KDF,
  deriveKey,
  randomSalt,
  type KdfParams,
} from "@/lib/crypto/argon";
import { importPasswordDerivedKey, wrapKey } from "@/lib/crypto/wrap";
import { retryFetchJson } from "@/lib/retry-fetch";

const MULTIPART_THRESHOLD = 100 * 1024 * 1024;
const MULTIPART_PART_SIZE = 32 * 1024 * 1024;
const MULTIPART_CONCURRENCY = 6;
const PART_URL_PREFETCH_BATCH = 24;

export type UploadPhase =
  | "idle"
  | "generating-key"
  | "wrapping-key"
  | "creating-transfer"
  | "encrypting-uploading"
  | "finalizing"
  | "done"
  | "error";

type StartArgs = {
  files: File[];
  ttl: "1d" | "7d" | "30d";
  downloadCap: 1 | 5 | 25 | null;
  recipientEmails?: string[];
  senderMessage?: string;
  password?: string;
};

export type UploadResult = {
  url: string;
  id: string;
  keyFingerprint: string;
};

type SingleUpload = {
  fileIndex: number;
  mode: "single";
  key: string;
  putUrl: string;
};

type MultipartUpload = {
  fileIndex: number;
  mode: "multipart";
  key: string;
  uploadId: string;
  partCount: number;
  partUrls: { partNumber: number; url: string }[];
};

type UploadSpec = SingleUpload | MultipartUpload;

type CreateResponse = {
  id: string;
  expiresAt: string;
  manifestUpload: { key: string; putUrl: string };
  uploads: UploadSpec[];
};

export function useUpload() {
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [bytesPerSec, setBytesPerSec] = useState<number | null>(null);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase("idle");
    setProgress(0);
    setStatusText("");
    setError(null);
    setResult(null);
    setBytesPerSec(null);
    setEtaSeconds(null);
  }, []);

  const start = useCallback(async (args: StartArgs) => {
    setError(null);
    setResult(null);
    setProgress(0);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    let transferId: string | null = null;
    try {
      setPhase("generating-key");
      setStatusText("Generating key…");
      const fileKey = await generateFileKey();

      let passwordBundle:
        | {
            salt: string;
            wrappedKey: string;
            kdfParams: KdfParams;
          }
        | null = null;
      if (args.password) {
        setPhase("wrapping-key");
        setStatusText("Deriving password key (this takes ~1s)…");
        const salt = randomSalt();
        const derivedBytes = await deriveKey(args.password, salt, DEFAULT_KDF);
        const pwKey = await importPasswordDerivedKey(derivedBytes);
        const wrapped = await wrapKey(fileKey.raw, pwKey);
        passwordBundle = {
          salt: bytesToB64u(salt),
          wrappedKey: bytesToB64u(wrapped),
          kdfParams: DEFAULT_KDF,
        };
      }

      const manifest: Manifest = {
        version: 1,
        message: args.senderMessage || undefined,
        files: args.files.map((f) => ({
          name: f.name,
          mime: f.type || "application/octet-stream",
          size: f.size,
          chunks: chunkCount(f.size),
        })),
      };
      const manifestBlob = await encryptManifest(fileKey.key, manifest);

      setPhase("creating-transfer");
      setStatusText("Preparing upload…");
      // retryFetchJson survives transient failures (pod restart, 5xx).
      // Caveat: if a retry happens after the server committed but before
      // the client received the response, we'll create a second Transfer
      // row with fresh presigned URLs. The original row's ciphertext will
      // never arrive, and the stale-incomplete sweep will clean it up.
      // Cost is one wasted ID, which is acceptable.
      const createData = await retryFetchJson<CreateResponse>(
        "/api/transfers",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({
            files: args.files.map((f) => ({
              sizeBytes: f.size,
              mode:
                f.size > MULTIPART_THRESHOLD ? "multipart" : "single",
            })),
            manifestSize: manifestBlob.length,
            password: passwordBundle,
            ttl: args.ttl,
            downloadCap: args.downloadCap,
            recipientEmails:
              args.recipientEmails && args.recipientEmails.length > 0
                ? args.recipientEmails
                : null,
            senderMessage: args.senderMessage || null,
          }),
        },
        {
          onRetry: ({ attempt }) =>
            setStatusText(`Preparing upload (retry ${attempt})…`),
        },
      );
      transferId = createData.id;

      setPhase("encrypting-uploading");
      setStatusText("Encrypting & uploading…");

      const totalCiphertextBytes =
        manifestBlob.length +
        args.files.reduce((n, f) => n + expectedCiphertextSize(f.size), 0);
      let uploadedBytes = 0;
      let lastTick = performance.now();
      let lastBytes = 0;
      let smoothedBps: number | null = null;
      let lastUiUpdate = 0;
      const bump = (n: number) => {
        uploadedBytes += n;
        const now = performance.now();
        if (now - lastTick >= 500) {
          const dt = (now - lastTick) / 1000;
          const instantaneous = (uploadedBytes - lastBytes) / dt;
          smoothedBps =
            smoothedBps == null
              ? instantaneous
              : smoothedBps * 0.7 + instantaneous * 0.3;
          lastTick = now;
          lastBytes = uploadedBytes;
        }
        if (now - lastUiUpdate >= 250) {
          lastUiUpdate = now;
          setProgress((uploadedBytes / totalCiphertextBytes) * 100);
          if (smoothedBps && smoothedBps > 0) {
            setBytesPerSec(smoothedBps);
            const remaining = totalCiphertextBytes - uploadedBytes;
            setEtaSeconds(Math.max(0, remaining / smoothedBps));
          }
        }
      };

      await uploadWithProgress(
        createData.manifestUpload.putUrl,
        manifestBlob,
        ctrl.signal,
        bump,
      );

      const completeFilesPayload: {
        fileIndex: number;
        parts?: { partNumber: number; eTag: string }[];
      }[] = [];

      for (let i = 0; i < args.files.length; i++) {
        const file = args.files[i];
        const spec = createData.uploads.find((u) => u.fileIndex === i);
        if (!spec) throw new Error(`No upload spec for file ${i}`);

        const encrypted = encryptStream(fileKey.key, file.stream());
        if (spec.mode === "single") {
          const blob = await collectStreamToBlob(encrypted);
          await uploadWithProgress(spec.putUrl, blob, ctrl.signal, bump);
          completeFilesPayload.push({ fileIndex: i });
        } else {
          const parts = await uploadMultipart(
            createData.id,
            spec,
            encrypted,
            ctrl.signal,
            bump,
          );
          completeFilesPayload.push({ fileIndex: i, parts });
        }
      }

      setPhase("finalizing");
      setStatusText("Finalizing…");
      const shareUrl = args.password
        ? `${window.location.origin}/t/${createData.id}`
        : `${window.location.origin}/t/${createData.id}#${encodeFragment(fileKey.raw)}`;

      // Complete is idempotent on the server: a second call after success
      // returns 409 `already_completed`. retryFetchJson treats 4xx as
      // terminal, so we wrap here to catch 409 and treat it as "done".
      await retryCompleteRequest(
        createData.id,
        completeFilesPayload,
        shareUrl,
        ctrl.signal,
        (attempt) => setStatusText(`Finalizing (retry ${attempt})…`),
      );

      setPhase("done");
      const rawB64u = bytesToB64u(fileKey.raw);
      const fp = args.password
        ? "password-locked"
        : `${rawB64u.slice(0, 4)}…${rawB64u.slice(-4)}`;
      setResult({ id: createData.id, url: shareUrl, keyFingerprint: fp });
    } catch (err) {
      if (ctrl.signal.aborted) {
        setPhase("idle");
        return;
      }
      setPhase("error");
      const msg = err instanceof Error ? err.message : "Upload failed.";
      setError(msg);
      if (transferId) {
        fetch(`/api/transfers/${transferId}`, { method: "DELETE" }).catch(
          () => {},
        );
      }
    } finally {
      abortRef.current = null;
    }
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
    phase,
    progress,
    statusText,
    error,
    result,
    bytesPerSec,
    etaSeconds,
    start,
    abort,
    reset,
  };
}

// /complete retry wrapper. Treats 409 `already_completed` as success —
// happens when a retry fires after the server successfully committed but
// the client didn't see the response (e.g. pod replaced mid-response).
async function retryCompleteRequest(
  transferId: string,
  files: { fileIndex: number; parts?: { partNumber: number; eTag: string }[] }[],
  shareUrl: string,
  signal: AbortSignal,
  onRetry: (attempt: number) => void,
): Promise<void> {
  const body = JSON.stringify({ files, shareUrl });
  let attempt = 0;
  const MAX = 5;
  while (true) {
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    try {
      const resp = await fetch(`/api/transfers/${transferId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body,
      });
      if (resp.ok) return;
      if (resp.status === 409) {
        // Already completed — must've been a retry after a successful first call.
        return;
      }
      if (resp.status >= 400 && resp.status < 500 && resp.status !== 408) {
        throw new Error(`Complete failed (${resp.status})`);
      }
      throw new Error(`Complete HTTP ${resp.status}`);
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") throw err;
      if (err instanceof Error && /^Complete failed/.test(err.message)) throw err;
      attempt += 1;
      if (attempt >= MAX) throw err;
      const delayMs = Math.min(300 * 2 ** (attempt - 1), 8000);
      onRetry(attempt);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delayMs);
        const onAbort = () => {
          clearTimeout(timer);
          reject(new DOMException("aborted", "AbortError"));
        };
        if (signal.aborted) {
          clearTimeout(timer);
          reject(new DOMException("aborted", "AbortError"));
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      });
    }
  }
}

async function collectStreamToBlob(
  stream: ReadableStream<Uint8Array>,
): Promise<Blob> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return new Blob(chunks as BlobPart[]);
}

async function uploadWithProgress(
  url: string,
  body: Blob | Uint8Array,
  signal: AbortSignal,
  onBytes: (n: number) => void,
): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.responseType = "text";
    let lastLoaded = 0;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const delta = e.loaded - lastLoaded;
        lastLoaded = e.loaded;
        if (delta > 0) onBytes(delta);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.getResponseHeader("ETag") ?? undefined);
      } else {
        reject(new Error(`PUT failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("PUT network error"));
    xhr.onabort = () => reject(new DOMException("aborted", "AbortError"));
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body as XMLHttpRequestBodyInit);
  });
}

async function uploadMultipart(
  transferId: string,
  spec: MultipartUpload,
  encrypted: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onBytes: (n: number) => void,
): Promise<{ partNumber: number; eTag: string }[]> {
  const reader = encrypted.getReader();
  const parts: { partNumber: number; eTag: string }[] = [];
  const partUrlCache = new Map<number, string>();
  for (const p of spec.partUrls) partUrlCache.set(p.partNumber, p.url);

  const inflight = new Set<Promise<void>>();
  let firstError: unknown = null;

  const getPartUrl = async (n: number): Promise<string> => {
    const cached = partUrlCache.get(n);
    if (cached) return cached;
    const batch: number[] = [];
    for (
      let i = n;
      i < n + PART_URL_PREFETCH_BATCH && i <= spec.partCount;
      i++
    ) {
      if (!partUrlCache.has(i)) batch.push(i);
    }
    if (batch.length === 0) throw new Error("no parts requested");
    // /parts is fully idempotent: same inputs produce fresh presigned URLs
    // with no DB mutation. Safe to retry freely on pod restart.
    const data = await retryFetchJson<{
      urls: { partNumber: number; url: string }[];
    }>(
      `/api/transfers/${transferId}/parts`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({
          fileIndex: spec.fileIndex,
          partNumbers: batch,
        }),
      },
    );
    for (const u of data.urls) partUrlCache.set(u.partNumber, u.url);
    const got = partUrlCache.get(n);
    if (!got) throw new Error("part URL missing after fetch");
    return got;
  };

  const launch = (partNumber: number, body: Uint8Array): void => {
    const task = (async () => {
      const url = await getPartUrl(partNumber);
      const etag = await uploadWithProgress(url, body, signal, onBytes);
      if (!etag) throw new Error("missing ETag on part");
      parts.push({ partNumber, eTag: etag.replace(/"/g, "") });
    })();
    const wrapped = task.catch((err) => {
      if (!firstError) firstError = err;
    });
    inflight.add(wrapped);
    wrapped.finally(() => inflight.delete(wrapped));
  };

  const waitForSlot = async (): Promise<void> => {
    while (inflight.size >= MULTIPART_CONCURRENCY && !firstError) {
      await Promise.race(inflight);
    }
  };

  // Chunk queue: never merge into one growing buffer (V8 caps ArrayBuffer
  // allocations and huge arrays cause OOM). We accumulate incoming chunks as
  // a list, and assemble exactly one part's worth (32 MiB) when cutting.
  const queue: Uint8Array[] = [];
  let queuedBytes = 0;
  let nextPart = 1;

  // Assemble a single part of up to MULTIPART_PART_SIZE bytes from the head
  // of the queue. Handles splitting a chunk that straddles the boundary.
  const takePart = (size: number): Uint8Array => {
    const out = new Uint8Array(size);
    let offset = 0;
    while (offset < size && queue.length > 0) {
      const head = queue[0];
      const need = size - offset;
      if (head.length <= need) {
        out.set(head, offset);
        offset += head.length;
        queue.shift();
      } else {
        out.set(head.subarray(0, need), offset);
        queue[0] = head.subarray(need);
        offset += need;
      }
    }
    queuedBytes -= size;
    return out;
  };

  const cutParts = async (final: boolean) => {
    while (
      queuedBytes >= MULTIPART_PART_SIZE ||
      (final && queuedBytes > 0)
    ) {
      if (firstError) return;
      const take = Math.min(queuedBytes, MULTIPART_PART_SIZE);
      await waitForSlot();
      if (firstError) return;
      const body = takePart(take);
      launch(nextPart++, body);
    }
  };

  try {
    while (!firstError) {
      // Backpressure: before reading more, let the worker pool drain if it's
      // saturated AND we already have one part's worth queued up. This caps
      // in-flight memory at roughly MULTIPART_CONCURRENCY * MULTIPART_PART_SIZE
      // (~192 MiB at concurrency 6) regardless of file size.
      if (
        queuedBytes >= MULTIPART_PART_SIZE &&
        inflight.size >= MULTIPART_CONCURRENCY
      ) {
        await Promise.race(inflight);
        continue;
      }
      const { value, done } = await reader.read();
      if (done) break;
      if (value && value.length) {
        queue.push(value);
        queuedBytes += value.length;
        await cutParts(false);
      }
    }
    await cutParts(true);
    while (inflight.size > 0) {
      await Promise.race(inflight);
    }
  } finally {
    reader.releaseLock();
  }

  if (firstError) throw firstError;
  parts.sort((a, b) => a.partNumber - b.partNumber);
  return parts;
}
