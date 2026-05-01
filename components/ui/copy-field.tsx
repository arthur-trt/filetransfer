"use client";

import { useRef, useState } from "react";
import styles from "./copy-field.module.css";

export function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      inputRef.current?.select();
      document.execCommand("copy");
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div className={styles.wrap}>
      <input
        ref={inputRef}
        className={styles.text}
        value={value}
        readOnly
        onFocus={(e) => e.currentTarget.select()}
      />
      <button type="button" className={styles.btn} onClick={copy}>
        <span className={copied ? styles.copied : undefined}>
          {copied ? "Copied" : "Copy"}
        </span>
      </button>
    </div>
  );
}
