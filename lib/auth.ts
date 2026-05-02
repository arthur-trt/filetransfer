import NextAuth from "next-auth";
import Nodemailer from "next-auth/providers/nodemailer";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";

const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  secret: process.env.AUTH_SECRET,
  // NextAuth v5 disables host trust by default in production. We run behind
  // Traefik (TLS terminates at the ingress; the pod only sees HTTP on :3000
  // with a forwarded Host header), so we MUST explicitly trust the incoming
  // host. Without this, NextAuth throws UntrustedHost and falls back to the
  // pod's bind address (0.0.0.0:3000), producing malformed callback URLs.
  trustHost: true,
  session: { strategy: "database" },
  providers: [
    Nodemailer({
      server: {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 587),
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      },
      from: process.env.EMAIL_FROM,
    }),
  ],
  pages: {
    signIn: "/admin/login",
    // NextAuth appends its own query (?error=…, none for verify). We send
    // the verify page to a distinct sub-path so it can show the "check your
    // inbox" message without query noise.
    verifyRequest: "/admin/login/sent",
    error: "/admin/login",
  },
  callbacks: {
    async signIn({ user }) {
      if (!adminEmail) return false;
      const email = (user.email ?? "").trim().toLowerCase();
      return email === adminEmail;
    },
    async session({ session }) {
      return session;
    },
  },
});
