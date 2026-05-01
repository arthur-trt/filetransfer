"use client";

import { useState, type KeyboardEvent, type ClipboardEvent } from "react";
import styles from "./chip-input.module.css";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Props = {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  max?: number;
};

export function ChipInput({ values, onChange, placeholder, max }: Props) {
  const [draft, setDraft] = useState("");

  function commit(raw: string): boolean {
    const candidates = raw
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (candidates.length === 0) return false;
    const next = [...values];
    let added = false;
    for (const c of candidates) {
      if (max != null && next.length >= max) break;
      if (!next.includes(c)) {
        next.push(c);
        added = true;
      }
    }
    if (added) onChange(next);
    return added;
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      if (draft.trim()) {
        e.preventDefault();
        if (commit(draft)) setDraft("");
      }
    } else if (e.key === "Backspace" && draft === "" && values.length > 0) {
      e.preventDefault();
      onChange(values.slice(0, -1));
    }
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    if (/[\s,;]/.test(text)) {
      e.preventDefault();
      if (commit(text)) setDraft("");
    }
  }

  function remove(idx: number) {
    onChange(values.filter((_, i) => i !== idx));
  }

  return (
    <div
      className={styles.wrap}
      onClick={(e) => {
        const input = e.currentTarget.querySelector("input");
        input?.focus();
      }}
    >
      {values.map((v, i) => (
        <span
          key={`${v}-${i}`}
          className={`${styles.chip} ${
            EMAIL_RE.test(v) ? "" : styles.chipInvalid
          }`}
        >
          {v}
          <button
            type="button"
            className={styles.remove}
            onClick={(e) => {
              e.stopPropagation();
              remove(i);
            }}
            aria-label={`Remove ${v}`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className={styles.input}
        value={draft}
        placeholder={values.length === 0 ? placeholder : ""}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={() => {
          if (draft.trim() && commit(draft)) setDraft("");
        }}
        type="email"
        inputMode="email"
      />
    </div>
  );
}
