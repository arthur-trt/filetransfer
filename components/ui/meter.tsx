import styles from "./meter.module.css";

type Props = {
  value: number;
  label?: string;
  rightLabel?: string;
};

export function Meter({ value, label, rightLabel }: Props) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={styles.wrap}>
      <div className={styles.track} role="progressbar" aria-valuenow={pct}>
        <div className={styles.fill} style={{ width: `${pct}%` }} />
      </div>
      {(label || rightLabel) && (
        <div className={styles.row}>
          <span>{label}</span>
          <span className={`${styles.pct} tnum`}>
            {rightLabel ?? `${pct.toFixed(0)}%`}
          </span>
        </div>
      )}
    </div>
  );
}
