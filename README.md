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

## Freelancer bench + SMS dispatch (Phase 11)

Cleaning companies get last-minute callouts. The freelancer bench lets
admins maintain a contact list of on-call cleaners (not Sollos users — no
account needed) and broadcast a single shift to the whole list via SMS.
The first freelancer to tap the unique claim link in their text gets the
job; everyone else sees a "too slow" page.

**Where it lives**
- `/app/freelancers` — contact CRUD + all broadcasted offers
- `/app/bookings/[id]/offer` — "Send to bench" form with live SMS preview
- `/app/freelancers/offers/[id]` — offer detail with per-dispatch status
- `/claim/[token]` — public no-login landing page the freelancer opens
  from the SMS. Pre-claim it shows pay + time + rough area; post-claim it
  reveals the full address and client phone.

**How the race is safe**
The claim action runs with the service-role client and updates
`job_offers` with a `status = 'open'` guard — only one caller can flip it
to `filled`. The second caller's update returns zero rows and the page
falls into the "already claimed" state.

**Twilio activation**
Twilio is wired in but disabled by default — `TWILIO_ENABLED=false` in
`.env.local.example`. While disabled:
- No SMS is sent. `sendSms()` logs the payload to the server console.
- Dispatch rows are marked `delivery_status = 'skipped_disabled'`.
- You can still preview every claim link by clicking them on the offer
  detail page — the entire claim flow works end-to-end without a Twilio
  account.

To go live:
1. Create a Twilio account and buy a local long-code number (~$1.15/mo)
2. Register an A2P 10DLC brand + campaign (required for US SMS to
   actually deliver — ~$55 one-time + $11/mo). See Twilio's A2P 10DLC
   guide.
3. Fill `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
   and set `TWILIO_ENABLED=true` in your environment (local + Vercel).
4. Test by sending yourself an offer from `/app/freelancers`.

**Cost profile** (rough): ~$55 first month + $11/mo carrier fees + about
$0.014 per SMS segment. A 160-char offer to 10 freelancers costs ~$0.14
per broadcast.

## Invoicing + payment integrations (Phase 12)

Sollos is the dashboard; the cleaning company is the merchant of record.
Money never touches a Sollos-owned account. When a client pays an
invoice, funds move directly from the client into the cleaning company's
connected processor account (Stripe, Square, or QuickBooks Payments).

### Part 1 — what's live now

- **Manual payment recording.** The invoice detail page
  (`/app/invoices/[id]`) has a "Record payment" form for cash, check,
  Zelle, Venmo, wire, etc. Payments are stored in `invoice_payments`
  and a DB trigger recomputes the parent invoice's `status` and
  `paid_at` based on the sum of payments — this is how `partially_paid`
  works.
- **Public invoice view.** Every invoice gets a capability-based public
  token (16 random bytes, base64url-encoded). Share
  `/i/<public_token>` with the client — no login required. They see
  the total, line items, payment instructions, and a grayed-out
  "Pay with card — coming soon" CTA that lights up in Part 2.
- **Send / void actions.** Admins can flip `draft → sent` (stamps
  `sent_at`) and void invoices (sets `voided_at` and blocks new
  payments).
- **Default payment instructions.** Configure once in
  `/app/settings/payment-methods` (Zelle handle, mailing address, wire
  details, etc). Every public invoice page pulls this as a fallback
  unless an individual invoice overrides it.
- **Integration scaffolding.** `/app/settings/integrations` has three
  provider cards (Stripe, Square, QuickBooks) that show "Coming soon"
  until the platform OAuth credentials land in env, then "Not connected"
  until the org clicks Connect. The underlying tables
  (`integration_connections`, `integration_events`) and encryption
  helpers (`src/lib/crypto.ts`, AES-256-GCM) are in place.
- **Token encryption at rest.** All OAuth access/refresh tokens will be
  encrypted with a key loaded from `INTEGRATION_ENCRYPTION_KEY`. Generate
  one with:
  ```bash
  node -e "console.log('base64:' + require('crypto').randomBytes(32).toString('base64'))"
  ```

### Part 2 — what's coming next (blocked on provider registration)

1. Register Sollos as an OAuth app on each provider dashboard:
   - **Stripe Connect Standard** — https://dashboard.stripe.com/settings/connect
   - **Square** — https://developer.squareup.com/apps
   - **Intuit / QuickBooks** — https://developer.intuit.com/app/developer/dashboard
2. Add the redirect URIs (`/api/integrations/<provider>/callback`) and
   populate the env vars in `.env.local.example` (Stripe Connect client
   id, Square app id/secret, Intuit client id/secret, etc).
3. Build the `/api/integrations/<provider>/callback` route handlers
   that complete the OAuth dance and insert into
   `integration_connections` (tokens encrypted via `encryptSecret()`).
4. Build `/api/integrations/<provider>/webhook` route handlers with
   idempotency via `integration_events (provider, event_id)` unique
   index.
5. Add "Pay now" buttons to the public invoice view — Checkout Session
   for Stripe, Payment Link for Square, Intuit Payments for QBO.

### Security posture

- `integration_connections.access_token_ciphertext` / `refresh_token_ciphertext`
  store AES-256-GCM ciphertext (wire format: `v1:iv:tag:ciphertext`).
  Even with service-role access, raw tokens never leave the app process.
- `integration_events` has a unique index on `(provider, event_id)` so
  replayed webhooks are dropped safely.
- `audit_log` has a BEFORE UPDATE/DELETE trigger that raises, so even
  the service-role key can't rewrite history.
- `invoice_payments` with `provider IS NOT NULL` can NOT be deleted
  manually from the UI — only via a refund webhook from the processor.

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
- ✅ **Phase 11** — Freelancer bench + SMS shift dispatch (Twilio-gated)
- 🚧 **Phase 12** — Invoicing + payment integrations (Part 1 shipped: manual payments, public invoice view, integration scaffolding; Part 2 blocked on Stripe/Square/Intuit OAuth app registration)
