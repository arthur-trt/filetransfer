import styles from "../page.module.css";
import { PageFrame } from "@/components/layout/page-frame";

export default function SentPage() {
  return (
    <PageFrame>
      <div className={styles.wrap}>
        <section className={styles.card}>
          <div>
            <h1 className={styles.title}>Check your inbox.</h1>
            <p className={styles.sub}>
              We&apos;ve sent a sign-in link. It expires in a few minutes.
            </p>
          </div>
        </section>
      </div>
    </PageFrame>
  );
}
