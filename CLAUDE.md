# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

WeTransfer/SwissTransfer-style file sharing app. Users upload files, get a shareable link (optionally password-protected, emailed to a recipient, with an expiration date). A lightweight admin dashboard shows transfer stats. Files are **end-to-end encrypted** — the server never sees plaintext.

Status: **greenfield**. No code has been written yet. The decisions below are the load-bearing ones — revisit them with the user before changing direction.

## Stack decisions

- **Framework**: Next.js (App Router) + TypeScript. One repo, server components for the admin dashboard, Route Handlers for the API, client components for upload/download UI (needed for WebCrypto).
- **Storage**: Cloudflare R2 via the AWS S3 SDK (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`). R2 chosen over AWS S3 specifically for **zero egress fees** — this app is download-heavy. Endpoint is `https://<account-id>.r2.cloudflarestorage.com`. Browser uploads/downloads use **presigned URLs** (never proxy through Next.js — would blow memory and egress budget).
- **Database**: Postgres + Prisma. Stores transfer metadata only (id, recipient email, expiration, password hash, wrapped key, file count/size, download count). **Never** stores the file encryption key in plaintext.
- **Email**: SMTP via Nodemailer (configured with `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`). React Email templates for the transfer-sent mail; NextAuth's built-in Nodemailer provider handles the admin magic link.
- **Auth (admin)**: Auth.js (NextAuth) with a single-admin credentials or magic-link provider. The public upload/download flow is **unauthenticated** — that's the product.

## End-to-end encryption model

This is the part most likely to be done wrong. The invariants:

1. **File key is generated in the browser** (AES-GCM 256) via `crypto.subtle.generateKey`. Never transmitted to the server.
2. **File is encrypted in the browser** before upload. Upload the ciphertext to R2 via presigned PUT.
3. **The key lives in the URL fragment** (`https://.../t/<id>#<base64url-key>`). Fragments are never sent to servers by browsers — that's what makes this E2E.
4. **If a password is set**: derive a wrapping key from the password via **Argon2id** (preferred) or PBKDF2-SHA256 with ≥600k iterations. Use it to wrap the file key with AES-KW or AES-GCM. Store only the wrapped key + salt + KDF params server-side.
5. **Server stores**: ciphertext in R2, metadata + wrapped-key-if-password in Postgres. **Server cannot decrypt** without the URL fragment (and password, if set).
6. **Admin dashboard can see metadata only** — counts, sizes, expirations, download counts. Never filenames, never contents. (Original filename can be encrypted alongside the file or stored only in the fragment alongside the key.)

Corollary: features that require reading file content (virus scanning, preview generation) are **incompatible** with E2E and must be rejected or done client-side before encryption.

## Expected layout (once scaffolded)

```
app/
  (public)/
    page.tsx              # Upload UI
    t/[id]/page.tsx       # Download UI (reads key from URL fragment)
  admin/
    layout.tsx            # Auth-gated
    page.tsx              # Dashboard
  api/
    transfers/
      route.ts            # POST: create transfer, return presigned PUT URL
      [id]/route.ts       # GET metadata, DELETE (admin)
      [id]/download/route.ts  # Returns presigned GET URL (after password check if any)
lib/
  crypto/                 # WebCrypto wrappers — browser only
  r2.ts                   # S3 client pointed at R2
  db.ts                   # Prisma client
  email/                  # Nodemailer + React Email templates
prisma/
  schema.prisma
```

## Commands

Once Next.js is scaffolded, these will be the canonical commands — keep package.json aligned:

```bash
npm run dev              # next dev
npm run build            # next build
npm run lint             # next lint
npm run typecheck        # tsc --noEmit
npm run test             # vitest (unit tests — especially for lib/crypto)
npm run test -- path     # single test file
npx prisma migrate dev   # create + apply migration in dev
npx prisma studio        # inspect DB
```

## Environment variables

Expected in `.env.local` (never commit). Keep `.env.example` up to date when adding new ones.

```
DATABASE_URL=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_PUBLIC_URL=            # optional: custom domain for downloads
SMTP_HOST=                # e.g. smtp.resend.com / smtp.postmarkapp.com / your own
SMTP_PORT=587             # 465 implies implicit TLS; 587 uses STARTTLS
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=               # e.g. "filetransfer <no-reply@yourdomain.com>"
AUTH_SECRET=
ADMIN_EMAIL=              # single-admin setup
APP_URL=                  # e.g. http://localhost:3000 — used in email links
CRON_SECRET=              # bearer token for /api/cron/sweep
```

## Schema changes

Every schema change ships with a migration file. CI enforces this — `prisma migrate diff` compares migrations to `schema.prisma` and fails the build on drift.

Workflow:

```bash
# 1. Edit prisma/schema.prisma
# 2. Generate the migration (applies it locally + writes the SQL file):
npx prisma migrate dev --name <verb-noun>       # e.g. add-download-history
# 3. Commit both the schema change and prisma/migrations/<timestamp>_<name>/
```

Migrations are forward-only. To "roll back" a shipped change, author a new migration that reverses it.

Prod rollout happens automatically: the init container runs `prisma migrate deploy` against the CNPG cluster on every Deployment. Never edit a migration that's already been merged — write a new one.

## Non-obvious rules

- **Never log or return the URL fragment server-side.** If you catch yourself adding `#key` to a server-side log or response body, stop — it defeats E2E.
- **Presigned URL TTL**: short (≤15 min for PUT, ≤1 hour for GET). The transfer's own expiration is enforced at the API layer before minting a GET URL.
- **Password verification**: don't store or compare the password server-side. The password's only job is to wrap the file key. "Wrong password" manifests as a client-side AES-GCM decrypt failure — surface it as "wrong password" in the UI.
- **Expired transfers**: mark as expired in DB + delete from R2 on a scheduled job (e.g. Vercel Cron or a `/api/cron/sweep` route hit by an external scheduler). Don't rely on R2 lifecycle rules alone — metadata and object must stay in sync.
- **Large files**: use S3 multipart upload with presigned part URLs. A single presigned PUT caps at 5 GB.
- **CORS on R2**: bucket must allow `PUT`, `GET` from `APP_URL` origin. Easy to forget; symptom is browser-console CORS errors on upload.
