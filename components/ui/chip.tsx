import type { HTMLAttributes } from "react";
import styles from "./chip.module.css";

type Tone = "default" | "accent" | "muted" | "danger";

type Props = HTMLAttributes<HTMLSpanElement> & { tone?: Tone };

export function Chip({ tone = "default", className, ...rest }: Props) {
  const toneCls =
    tone === "accent"
      ? styles.accent
      : tone === "muted"
      ? styles.muted
      : tone === "danger"
      ? styles.danger
      : "";
  return (
    <span
      className={`${styles.chip} ${toneCls} ${className ?? ""}`}
      {...rest}
    />
  );
}
