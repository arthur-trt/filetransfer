import styles from "./code-tag.module.css";

export function CodeTag({ children }: { children: React.ReactNode }) {
  return <code className={styles.tag}>{children}</code>;
}
