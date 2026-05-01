import type { ReactNode } from "react";
import styles from "./section.module.css";

type Props = {
  number?: string;
  label?: string;
  children: ReactNode;
};

export function Section({ number, label, children }: Props) {
  return (
    <section className={styles.section}>
      {(number || label) && (
        <header className={styles.header}>
          <span className={styles.label}>
            {number && <span className={styles.num}>{number}</span>}
            {number && label && " — "}
            {label}
          </span>
        </header>
      )}
      <div className={styles.body}>{children}</div>
    </section>
  );
}
