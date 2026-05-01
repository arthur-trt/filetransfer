"use client";

import { useState } from "react";
import styles from "./page.module.css";
import { PageFrame } from "@/components/layout/page-frame";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea, Segmented } from "@/components/ui/field";
import { ChipInput } from "@/components/ui/chip-input";
import { Button } from "@/components/ui/button";
import { Meter } from "@/components/ui/meter";
import { formatBytes, formatDuration } from "@/lib/format";
import { ViewportDropZone } from "@/components/upload/drop-zone";
import { FileList } from "@/components/upload/file-list";
import { ShareResult } from "@/components/upload/share-result";
import { useUpload } from "@/components/upload/use-upload";

type Expires = "1d" | "7d" | "30d";
type Cap = "1" | "5" | "25" | "∞";

const EXPIRES_LABEL: Record<Expires, string> = {
  "1d": "in 1 day",
  "7d": "in 7 days",
  "30d": "in 30 days",
};

const CAP_TO_NUMBER: Record<Cap, 1 | 5 | 25 | null> = {
  "1": 1,
  "5": 5,
  "25": 25,
  "∞": null,
};

export default function UploadPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [password, setPassword] = useState("");
  const [expires, setExpires] = useState<Expires>("7d");
  const [cap, setCap] = useState<Cap>("∞");
  const upload = useUpload();

  function addFiles(next: File[]) {
    setFiles((cur) => [...cur, ...next]);
  }

  function removeFile(idx: number) {
    setFiles((cur) => cur.filter((_, i) => i !== idx));
  }

  function startOver() {
    setFiles([]);
    setRecipients([]);
    setMessage("");
    setPassword("");
    upload.reset();
  }

  async function onUploadClick() {
    if (files.length === 0) return;
    await upload.start({
      files,
      ttl: expires,
      downloadCap: CAP_TO_NUMBER[cap],
      recipientEmails: recipients.length > 0 ? recipients : undefined,
      senderMessage: message || undefined,
      password: password || undefined,
    });
  }

  const totalBytes = files.reduce((n, f) => n + f.size, 0);
  const isBusy =
    upload.phase !== "idle" &&
    upload.phase !== "done" &&
    upload.phase !== "error";

  return (
    <PageFrame>
      <ViewportDropZone onFiles={addFiles} />
      <div className={styles.grid}>
        <div className={styles.hero}>
          <h1 className="display">
            Send something.{" "}
            <span className="accent">Encrypted in your browser.</span>
          </h1>
          <p className={styles.subhead}>
            Files are encrypted on your device before they leave it. The
            decryption key travels in the link, not through our servers.
          </p>
          <div className={styles.proof}>
            <div className={styles.proofRow}>
              <span className={styles.proofNum}>01</span>
              <span>
                Your browser generates an AES-256 key. It stays in memory.
              </span>
            </div>
            <div className={styles.proofRow}>
              <span className={styles.proofNum}>02</span>
              <span>Files are encrypted locally, then uploaded.</span>
            </div>
            <div className={styles.proofRow}>
              <span className={styles.proofNum}>03</span>
              <span>
                The key rides in the URL fragment (<code>#…</code>). Servers
                never see it.
              </span>
            </div>
          </div>
        </div>

        <div className={styles.panel}>
          {upload.phase === "done" && upload.result ? (
            <Card number="02" label="SHARE">
              <ShareResult
                url={upload.result.url}
                keyFingerprint={upload.result.keyFingerprint}
                totalBytes={totalBytes}
                fileCount={files.length}
                expiresLabel={EXPIRES_LABEL[expires]}
                recipient={recipients.length > 0 ? recipients.join(", ") : undefined}
                onStartOver={startOver}
              />
            </Card>
          ) : (
            <Card number="01" label="SEND">
              {isBusy ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <Meter
                    value={upload.progress}
                    label={upload.statusText}
                    rightLabel={`${upload.progress.toFixed(0)}%`}
                  />
                  <p
                    style={{
                      fontSize: 13,
                      color: "var(--ink-muted)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {files.length} file{files.length === 1 ? "" : "s"} ·
                    AES-256-GCM · chunked
                    {upload.bytesPerSec != null &&
                      upload.etaSeconds != null && (
                        <>
                          {" · "}
                          {formatBytes(upload.bytesPerSec)}/s ·{" "}
                          {formatDuration(upload.etaSeconds)} left
                        </>
                      )}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => upload.abort()}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <>
                  <FileList
                    files={files}
                    onAdd={addFiles}
                    onRemove={removeFile}
                  />
                  {files.length > 0 && (
                    <div className={styles.fieldsGrid}>
                      <Field
                        label="To"
                        hint="Press Enter or comma to add each recipient (up to 10). We'll email the link to each one separately."
                      >
                        <ChipInput
                          values={recipients}
                          onChange={setRecipients}
                          placeholder="name@example.com"
                          max={10}
                        />
                      </Field>
                      <Field label="Message">
                        <Textarea
                          placeholder="Optional note"
                          value={message}
                          onChange={(e) => setMessage(e.target.value)}
                        />
                      </Field>
                      <Field
                        label="Password"
                        hint="Adds a second layer (Argon2id). Not recoverable."
                      >
                        <Input
                          type="password"
                          placeholder="Optional"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                        />
                      </Field>
                      <Field label="Expires">
                        <div style={{ paddingTop: 4 }}>
                          <Segmented<Expires>
                            value={expires}
                            onChange={setExpires}
                            options={[
                              { value: "1d", label: "1 day" },
                              { value: "7d", label: "7 days" },
                              { value: "30d", label: "30 days" },
                            ]}
                          />
                        </div>
                      </Field>
                      <Field label="Download cap">
                        <div style={{ paddingTop: 4 }}>
                          <Segmented<Cap>
                            value={cap}
                            onChange={setCap}
                            options={[
                              { value: "1", label: "1" },
                              { value: "5", label: "5" },
                              { value: "25", label: "25" },
                              { value: "∞", label: "∞" },
                            ]}
                          />
                        </div>
                      </Field>
                    </div>
                  )}
                  {upload.phase === "error" && upload.error && (
                    <p
                      style={{
                        fontSize: 13,
                        color: "var(--danger)",
                        borderLeft: "2px solid var(--danger)",
                        paddingLeft: "var(--s-3)",
                      }}
                    >
                      {upload.error}
                    </p>
                  )}
                  <div className={styles.actions}>
                    <span className={styles.fineprint}>
                      AES-256-GCM · Argon2id KDF
                    </span>
                    <Button
                      onClick={onUploadClick}
                      disabled={files.length === 0}
                    >
                      Encrypt & upload →
                    </Button>
                  </div>
                </>
              )}
            </Card>
          )}
        </div>
      </div>
    </PageFrame>
  );
}
