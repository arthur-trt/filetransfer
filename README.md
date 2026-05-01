# filetransfer

End-to-end encrypted file sharing. WeTransfer/SwissTransfer-style. Files are encrypted in the browser with AES-256-GCM; the key lives in the URL fragment (or is derived from a password via Argon2id) and never touches the server.

## Setup

Requires Node 20+.

```bash
npm install
cp .env.example .env.local
# fill in every variable (see below)
npm run prisma:migrate
npm run dev
```

Open http://localhost:3000.

## Tests

```bash
npm test           # run once
npm run test:watch # re-run on file changes
```

Covers the crypto round-trips (encrypt/decrypt streams, password wrap/unwrap, Argon2id, fragment encoding, manifest) and Zod validation. The same suite runs on every PR via `.github/workflows/ci.yml` — green CI is a prerequisite for auto-merging Dependabot / Renovate bumps.

## Environment

- `DATABASE_URL` — Postgres (Neon, Supabase, local, etc.)
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` — Cloudflare R2 credentials + bucket name
- `R2_PUBLIC_URL` — optional custom domain for downloads
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` — SMTP credentials for transactional email (transfer notifications + admin magic link). Port 465 implies TLS; any other port uses STARTTLS.
- `AUTH_SECRET` — random 32+ bytes (`openssl rand -base64 32`)
- `ADMIN_EMAIL` — the single admin address; only this email can sign in at `/admin`
- `APP_URL` — full origin, used for magic-link redirects
- `CRON_SECRET` — bearer token for the sweep endpoint

## R2 bucket CORS

Configure in the Cloudflare dashboard (**R2 → your bucket → Settings → CORS policy**):

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

Add your production origin when deploying. **`ETag` in `ExposeHeaders` is required** — the multipart upload code reads it to commit parts.

## Threat model & caveats

- **Zero-knowledge vs. our server**: the decryption key is generated in the browser. It lives in the URL fragment (`#…`) and is never sent to our backend.
- **Emailing a link**: the email contains the full URL including the fragment. Your SMTP provider and the recipient's mail provider see it in transit. This is documented explicitly in the UI. For the highest-assurance flow, don't use the email-to field — share the URL through a channel you trust.
- **Password-protected transfers**: when the sender sets a password, the URL fragment is empty. The password derives (via Argon2id, m=64 MiB, t=3, p=1) a key that unwraps the AES file key. A wrong password fails client-side; no server round-trip.
- **Admin sees metadata only**: file count, size, timestamps, download count, "has password". Never filenames, never contents.

## Routes

- `/` — upload
- `/t/<id>#…` — download (fragment carries the key unless password-protected)
- `/admin` — dashboard (auth required)
- `/admin/login` — magic-link sign-in (accepts only `ADMIN_EMAIL`)
- `POST /api/cron/sweep` — invoked by an external scheduler; deletes expired transfers + stale incomplete uploads

## Cron setup

The server exposes `POST /api/cron/sweep` guarded by `Authorization: Bearer $CRON_SECRET`. Hit it every 15 minutes from any scheduler.

### Vercel Cron (`vercel.json`):

```json
{
  "crons": [{ "path": "/api/cron/sweep", "schedule": "*/15 * * * *" }]
}
```

Vercel sets a `vercel-cron` header; if you deploy there, swap the bearer check for a `request.headers.get("user-agent")?.startsWith("vercel-cron/")` check.

### External (cron-job.org / GitHub Actions / Kubernetes CronJob):

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://your-app/api/cron/sweep
```

## Production rate limiting

Rate limiting lives at the ingress, not in the app. The app reads `x-forwarded-for`, so any per-IP limiter in front of the pod works. Enforce these caps:

| Path | Method | Limit | Why |
| --- | --- | --- | --- |
| `/api/transfers` | POST | 5/min, 30/hour | caps transfers per IP — storage abuse vector |
| `/api/transfers/*/download` | POST | 30/min | slows enumeration / presigned-URL harvesting |
| `/admin/login` | POST | 5/hour | stops mail-spam relay via magic links |

**Don't** rate-limit `POST /api/transfers/*/parts` — a single legitimate 50 GB upload calls it hundreds of times. The `/api/transfers` cap already bounds multipart initiations.

### NGINX Ingress (Kubernetes)

Annotations are per-Ingress, not per-rule, so split into three Ingresses sharing the same backend `Service`:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: filetransfer-create
  annotations:
    nginx.ingress.kubernetes.io/limit-rpm: "5"
    nginx.ingress.kubernetes.io/limit-connections: "2"
spec:
  rules:
    - host: files.example.com
      http:
        paths:
          - path: /api/transfers
            pathType: Exact
            backend: { service: { name: filetransfer, port: { number: 3000 } } }
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: filetransfer-download
  annotations:
    nginx.ingress.kubernetes.io/limit-rpm: "30"
spec:
  rules:
    - host: files.example.com
      http:
        paths:
          - path: /api/transfers/.+/download
            pathType: ImplementationSpecific
            backend: { service: { name: filetransfer, port: { number: 3000 } } }
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: filetransfer-login
  annotations:
    nginx.ingress.kubernetes.io/limit-rpm: "1"    # ≈ 5/hour with burst
spec:
  rules:
    - host: files.example.com
      http:
        paths:
          - path: /admin/login
            pathType: Exact
            backend: { service: { name: filetransfer, port: { number: 3000 } } }
```

Everything else (the main app, the catch-all `/`) stays on a fourth Ingress with no limits. Confirm ingress-nginx is configured to trust your real-client-IP header (`use-forwarded-headers: "true"` in the `ConfigMap`); otherwise all requests share a single "IP" and the limiter does nothing useful.

### Traefik

```yaml
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata: { name: rl-create }
spec:
  rateLimit: { average: 5, period: 1m, burst: 10, sourceCriterion: { ipStrategy: { depth: 1 } } }
---
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata: { name: rl-download }
spec:
  rateLimit: { average: 30, period: 1m, burst: 60, sourceCriterion: { ipStrategy: { depth: 1 } } }
---
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata: { name: rl-login }
spec:
  rateLimit: { average: 5, period: 1h, burst: 5, sourceCriterion: { ipStrategy: { depth: 1 } } }
```

Attach each to the matching `IngressRoute` rule. Set `ipStrategy.depth` to the number of proxies between your load balancer and Traefik (usually 1 or 2).

### Envoy / Istio / Cloudflare

Any per-IP token-bucket limiter in front of those three path patterns at the caps above is sufficient. Nothing to change in the app.

## Docker

Multi-stage build producing a ~250 MB image based on `node:22-slim`. Next.js standalone output; Prisma query engine + CLI are bundled so the same image can also run migrations.

```bash
docker build -t filetransfer:dev .
```

Run migrations against your Postgres (one-shot), then start the server:

```bash
docker run --rm --env-file .env.local filetransfer:dev \
  npx prisma migrate deploy

docker run --rm -p 3000:3000 --env-file .env.local filetransfer:dev
```

On Kubernetes, use the same image for both:
- **Init container** — `command: ["npx", "prisma", "migrate", "deploy"]`
- **Main container** — default `CMD` (`node server.js`)

The container runs as non-root UID 1001. All config comes from env vars — nothing is baked into the image.

## Stack

- Next.js 15 (App Router) + React 19 + TypeScript
- Postgres + Prisma
- Cloudflare R2 via `@aws-sdk/client-s3` with presigned URLs (browser talks directly to R2 — nothing is proxied through Next.js)
- `hash-wasm` for Argon2id
- NextAuth v5 with the Nodemailer provider (SMTP)
- `@react-email/components` for transactional templates
- CSS variables + CSS Modules (no Tailwind)

## Limits

- 50 GB per file
- 100 GB per transfer
- 100 files per transfer
- Files > 100 MB use S3 multipart upload (32 MiB parts)
- Downloads: Chromium-based browsers stream to disk (any size). Firefox/Safari buffer in memory (500 MB cap with a visible warning).
