import type { HTMLAttributes, ReactNode } from "react";
import styles from "./card.module.css";

type Props = HTMLAttributes<HTMLElement> & {
  number?: string;
  label?: string;
  dense?: boolean;
  children: ReactNode;
};

export function Card({
  number,
  label,
  dense,
  children,
  className,
  ...rest
}: Props) {
  return (
    <section
      className={`${styles.card} ${dense ? styles.dense : ""} ${
        className ?? ""
      }`}
      {...rest}
    >
      {(number || label) && (
        <div className={styles.label}>
          {number && <span className={styles.labelNum}>{number}</span>}
          {label && <span>{label}</span>}
        </div>
      )}
      {children}
    </section>
  );
}
