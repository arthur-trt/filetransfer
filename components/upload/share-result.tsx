"use client";

import styles from "./share-result.module.css";
import { CopyField } from "../ui/copy-field";
import { CodeTag } from "../ui/code-tag";
import { Button } from "../ui/button";
import { formatBytes } from "@/lib/format";

type Props = {
  url: string;
  keyFingerprint: string;
  totalBytes: number;
  fileCount: number;
  expiresLabel: string;
  recipient?: string;
  onStartOver: () => void;
};

export function ShareResult({
  url,
  keyFingerprint,
  totalBytes,
  fileCount,
  expiresLabel,
  recipient,
  onStartOver,
}: Props) {
  return (
    <div className={styles.wrap}>
      <h2 className={styles.headline}>
        Sent. <span className="accent">Keep this link safe.</span>
      </h2>
      <p className={styles.note}>
        The key lives only in the <CodeTag>#</CodeTag> part of the URL. The
        server can&apos;t decrypt without it.
      </p>
      <CopyField value={url} />
      <div className={styles.meta}>
        <span className={styles.metaItem}>
          <span className={styles.metaKey}>key</span>
          <CodeTag>{keyFingerprint}</CodeTag>
        </span>
        <span className={styles.metaItem}>
          <span className={styles.metaKey}>files</span>
          <span className={styles.metaVal}>{fileCount}</span>
        </span>
        <span className={styles.metaItem}>
          <span className={styles.metaKey}>size</span>
          <span className={styles.metaVal}>{formatBytes(totalBytes)}</span>
        </span>
        <span className={styles.metaItem}>
          <span className={styles.metaKey}>expires</span>
          <span className={styles.metaVal}>{expiresLabel}</span>
        </span>
        {recipient && (
          <span className={styles.metaItem}>
            <span className={styles.metaKey}>emailed to</span>
            <span className={styles.metaVal}>{recipient}</span>
          </span>
        )}
      </div>
      <div className={styles.actions}>
        <Button variant="secondary" size="sm" onClick={onStartOver}>
          Send another →
        </Button>
      </div>
    </div>
  );
}
