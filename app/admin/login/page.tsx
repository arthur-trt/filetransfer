import styles from "./page.module.css";
import { PageFrame } from "@/components/layout/page-frame";
import { Field, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { signIn } from "@/lib/auth";

type SearchParams = Promise<{ sent?: string; err?: string }>;

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { sent, err } = await searchParams;

  async function doSignIn(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim();
    if (!email) return;
    await signIn("nodemailer", { email, redirectTo: "/admin" });
  }

  return (
    <PageFrame>
      <div className={styles.wrap}>
        <section className={styles.card}>
          <div>
            <h1 className={styles.title}>Admin access</h1>
            <p className={styles.sub}>
              We&apos;ll email you a magic link. Only the configured admin
              address is accepted.
            </p>
          </div>
          {sent ? (
            <p className="small accent">
              Check your inbox. The link expires shortly.
            </p>
          ) : (
            <form action={doSignIn}>
              <Field
                label="Email"
                error={err ? "That didn't work — try again." : undefined}
              >
                <Input
                  type="email"
                  name="email"
                  placeholder="you@domain.com"
                  required
                />
              </Field>
              <div style={{ marginTop: 16 }}>
                <Button type="submit">Send link →</Button>
              </div>
            </form>
          )}
        </section>
      </div>
    </PageFrame>
  );
}
