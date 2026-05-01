"use client";

import { useRef } from "react";
import styles from "./file-list.module.css";
import { formatBytes } from "@/lib/format";

type Props = {
  files: File[];
  onAdd: (files: File[]) => void;
  onRemove: (idx: number) => void;
};

export function FileList({ files, onAdd, onRemove }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  function openPicker() {
    inputRef.current?.click();
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length) onAdd(picked);
    e.target.value = "";
  }

  const total = files.reduce((n, f) => n + f.size, 0);

  if (files.length === 0) {
    return (
      <>
        <div
          className={styles.empty}
          onClick={openPicker}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openPicker();
            }
          }}
        >
          <span className={styles.emptyHead}>+ Add files or drop anywhere</span>
          <span className={styles.emptySub}>
            They stay on your device until encryption completes.
          </span>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          className={styles.hiddenInput}
          onChange={onInputChange}
        />
      </>
    );
  }

  return (
    <div>
      <div className={styles.list}>
        {files.map((f, i) => (
          <div className={styles.row} key={`${f.name}-${i}`}>
            <span className={styles.name} title={f.name}>
              {f.name}
            </span>
            <span className={styles.size}>{formatBytes(f.size)}</span>
            <button
              type="button"
              className={styles.remove}
              aria-label={`Remove ${f.name}`}
              onClick={() => onRemove(i)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className={styles.total}>
        <button
          type="button"
          onClick={openPicker}
          style={{
            background: "transparent",
            border: "none",
            padding: 0,
            color: "var(--ink)",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          + Add more
        </button>
        <span>
          <span className={styles.totalStrong}>{files.length}</span> file
          {files.length === 1 ? "" : "s"} ·{" "}
          <span className={styles.totalStrong}>{formatBytes(total)}</span>
        </span>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        className={styles.hiddenInput}
        onChange={onInputChange}
      />
    </div>
  );
}
