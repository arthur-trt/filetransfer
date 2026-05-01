import type { ReactNode } from "react";
import Link from "next/link";
import styles from "./page-frame.module.css";
import { Wordmark } from "./wordmark";
import { Chip } from "../ui/chip";

type Props = {
  children: ReactNode;
  right?: ReactNode;
  showAlgoChip?: boolean;
  year?: number;
};

export function PageFrame({
  children,
  right,
  showAlgoChip = true,
  year,
}: Props) {
  return (
    <div className={styles.frame}>
      <div className={styles.inner}>
        <header className={styles.topbar}>
          <Link href="/" aria-label="Home">
            <Wordmark />
          </Link>
          <div className={styles.topbarRight}>
            {showAlgoChip && <Chip tone="muted">AES-256-GCM</Chip>}
            {right}
          </div>
        </header>
        {children}
        <footer className={styles.footer}>
          <span>© {year ?? new Date().getFullYear()} filetransfer</span>
          <span>End-to-end encrypted · Zero knowledge</span>
        </footer>
      </div>
    </div>
  );
}
