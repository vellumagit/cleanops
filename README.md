# Sollos 3

Multi-tenant operations software for cleaning companies. Built as a SaaS from day one — single tenant in production now, additional tenants onboardable without code changes.

> The internal repo / package name is still `cleanops` from the original scaffold. The product name, all user-facing copy, and the visual identity are Sollos 3. Renaming the package would churn the lockfile + deploy history for zero user-visible benefit.

## Stack

- **Next.js 16** (App Router) + **TypeScript**
- **Tailwind CSS 4** + **shadcn/ui** (Base UI primitives)
- **Supabase** — Postgres + Auth + Storage + Realtime, with **Row-Level Security** on every table
- **Vercel** for hosting
- **pnpm** for package management

## Getting started

### 1. Prerequisites

- Node.js 20+
- pnpm 10+
- A Supabase project (free tier is fine)

### 2. Install

```bash
pnpm install
```

### 3. Environment variables

```bash
cp .env.local.example .env.local
```

Fill in `.env.local` with the values from your Supabase project (Settings → API).

### 4. Run the dev server

```bash
pnpm dev
```

Visit [http://localhost:3000](http://localhost:3000).

## Project structure

```
cleanops/
├── src/
│   ├── app/
│   │   ├── (marketing)/        # public pages, login, signup
│   │   ├── (app)/              # ops console (admin/owner)
│   │   ├── (field)/            # field app (employees)
│   │   └── api/                # webhooks
│   ├── components/
│   │   └── ui/                 # shadcn primitives
│   ├── lib/
│   │   ├── supabase/           # server / client / admin Supabase factories
│   │   ├── auth.ts             # auth helpers
│   │   ├── audit.ts            # audit log helper
│   │   └── validators/         # Zod schemas
│   └── hooks/
├── supabase/
│   ├── migrations/             # numbered SQL migrations
│   └── seed.sql
├── scripts/
│   └── seed.ts                 # idempotent dev seed
└── public/
```

## Architecture principles

1. **Multi-tenant by default** — every domain table has `organization_id` and RLS policies enforce isolation at the database level.
2. **Three roles** — `owner`, `admin`, `employee`. Roles live on `memberships`, not `profiles`.
3. **Server-first** — data fetching happens in React Server Components and server actions. The browser never sees the service-role key.
4. **Audit log** — every sensitive mutation writes a row to `audit_log`.
5. **Type safety end-to-end** — DB types generated from Supabase schema.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Run the Next.js dev server with Turbopack |
| `pnpm build` | Production build |
| `pnpm start` | Run the production build |
| `pnpm lint` | Lint with ESLint |
| `pnpm seed` | Reset and seed the dev database with realistic fake data (added in Phase 9) |

## Pre-launch hardening (Phase 10)

### Audit log
Every sensitive mutation in the ops console writes a row to `audit_log` via
`src/lib/audit.ts`. The owner / admin viewer lives at
**Settings → Audit log** (`/app/settings/audit-log`) and shows the most recent
200 events. The table is RLS-protected and append-only — there is no UPDATE
or DELETE policy at the database level.

### Security headers + CSP
Configured in `next.config.ts`. Highlights:

- `Content-Security-Policy` with `default-src 'self'`, scoped allowances for
  the configured Supabase host (REST + Realtime), Sentry ingest, and Stripe.
- `frame-ancestors 'none'` + `X-Frame-Options: DENY` (anti-clickjacking).
- `Strict-Transport-Security` with a 2-year max-age, **production only**.
- `Permissions-Policy` denies camera / mic, allows geolocation only on
  same-origin (the field clock-in flow needs it).
- `Referrer-Policy: strict-origin-when-cross-origin`.

### Sentry (error tracking)
Scaffolded in env vars; install when ready:

```bash
pnpm add @sentry/nextjs
npx @sentry/wizard -i nextjs
```

The wizard populates `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`,
`SENTRY_PROJECT`, and `SENTRY_AUTH_TOKEN`. The CSP already allow-lists
`https://*.ingest.sentry.io` for the transport.

### Resend (transactional email)
Scaffolded in env vars (`RESEND_API_KEY`, `EMAIL_FROM`). Install when ready:

```bash
pnpm add resend
```

Use it for: signup welcome, invoice sent, password reset, review-request
links. Until the key is set, all email helpers no-op and log to the
console so dev does not require a real provider.

### Stripe (billing, scaffolded but disabled)
Schema, webhook route, and billing portal stub are in place but the feature
flag `STRIPE_ENABLED` defaults to `false`:

- Migration: `supabase/migrations/20260408020000_subscriptions.sql` — adds
  the tenant-scoped `subscriptions` mirror table with read-only RLS for
  members of the org.
- Route: `src/app/api/stripe/webhook/route.ts` — returns 503 until
  `STRIPE_ENABLED=true`. Skeleton dispatch for `customer.subscription.*`
  events upserts into `subscriptions` via the service-role client.
- UI: `src/app/app/settings/billing/page.tsx` shows the current plan and
  a disabled "Manage in Stripe" button.

To enable:

```bash
pnpm add stripe
# 1. Replace the placeholder in src/lib/stripe.ts with the real verifier:
#      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
#      const event = stripe.webhooks.constructEvent(rawBody, signature, secret);
# 2. Set STRIPE_ENABLED=true + fill in the Stripe keys in your env.
# 3. Add the webhook URL in the Stripe dashboard:
#      https://<your-domain>/api/stripe/webhook
```

### Backups
Supabase runs an automated daily backup on every project. Verify in
**Supabase dashboard → Database → Backups** that:

1. **Daily backups are enabled** (default on the free tier and above).
2. **PITR (Point-in-Time Recovery)** is enabled on Pro+ projects — gives
   you 7 days of granular restore.

#### Restore drill (run quarterly)

1. In the Supabase dashboard, pick a backup → **Restore to a new project**.
2. Note the new project ref + URL + service-role key.
3. Point a throwaway Vercel preview deployment at the restored project by
   overriding `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   and `SUPABASE_SERVICE_ROLE_KEY`.
4. Sign in as the seeded owner and confirm clients, bookings, invoices,
   chat threads and the audit log are intact.
5. Tear down the throwaway project.

Document the date + outcome in the team wiki so the drill is auditable.

### Privacy + Terms
Stub `/privacy` and `/terms` pages live so paying customers have something
to point at. Replace the wording with counsel-reviewed copy before the
first paid customer onboards.

## Deployment

Push to `main` → Vercel auto-deploys. Environment variables are set in the Vercel dashboard, never committed.

## Build status

This project follows the phased build plan in `C:\Users\musil\.claude\plans\logical-soaring-engelbart.md`.

- ✅ **Phase 0** — Foundation (scaffold, dependencies, shadcn, env, git, deploy)
- ✅ **Phase 1** — Auth + multi-tenancy spine
- ✅ **Phase 2** — Domain schema + RLS
- ✅ **Phase 3** — Ops console shell + read-only listings
- ✅ **Phase 4** — Ops console CRUD
- ✅ **Phase 5** — Scheduling
- ✅ **Phase 6** — Field app
- ✅ **Phase 7** — Reviews + bonuses
- ✅ **Phase 8** — Chat
- ✅ **Phase 9** — Seed data
- ✅ **Phase 10** — Pre-launch hardening (audit log viewer, CSP + security headers, privacy/terms stubs, Stripe scaffold, Sentry/Resend env, backup drill docs)
