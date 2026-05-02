import styles from "./page.module.css";
import { PageFrame } from "@/components/layout/page-frame";
import { Field, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { signIn } from "@/lib/auth";

type SearchParams = Promise<{
  error?: string;
}>;

const ERROR_MESSAGES: Record<string, string> = {
  Configuration: "Server misconfiguration. Check the pod logs.",
  AccessDenied: "This email address isn't allowed to sign in.",
  Verification: "That link has expired or already been used.",
};

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { error } = await searchParams;
  const errorMessage = error
    ? (ERROR_MESSAGES[error] ?? `Sign-in failed (${error}).`)
    : undefined;

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
          <form action={doSignIn}>
            <Field label="Email" error={errorMessage}>
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
        </section>
      </div>
    </PageFrame>
  );
}
