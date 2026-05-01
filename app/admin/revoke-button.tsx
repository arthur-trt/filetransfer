"use client";

import { useTransition } from "react";
import { revokeTransfer } from "./actions";

export function RevokeButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!confirm("Revoke this transfer? Files will be deleted.")) return;
        start(async () => {
          await revokeTransfer(id);
        });
      }}
      style={{
        background: "transparent",
        border: "none",
        color: "var(--danger)",
        fontSize: 12,
        fontWeight: 500,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        cursor: pending ? "wait" : "pointer",
        padding: "4px 8px",
        borderRadius: "var(--r-1)",
      }}
    >
      {pending ? "…" : "Revoke"}
    </button>
  );
}
