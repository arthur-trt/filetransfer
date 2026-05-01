import styles from "./wordmark.module.css";

export function Wordmark() {
  return (
    <span className={styles.mark}>
      <span className={styles.glyph} aria-hidden />
      <span className={styles.name}>filetransfer</span>
    </span>
  );
}
