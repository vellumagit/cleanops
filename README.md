# CleanOps

Multi-tenant operations software for cleaning companies. Built as a SaaS from day one — single tenant in production now, additional tenants onboardable without code changes.

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

## Deployment

Push to `main` → Vercel auto-deploys. Environment variables are set in the Vercel dashboard, never committed.

## Build status

This project follows the phased build plan in `C:\Users\musil\.claude\plans\logical-soaring-engelbart.md`.

- ✅ **Phase 0** — Foundation (scaffold, dependencies, shadcn, env, git, deploy)
- ⏳ **Phase 1** — Auth + multi-tenancy spine
- ⏳ **Phase 2** — Domain schema + RLS
- ⏳ **Phase 3** — Ops console shell + read-only listings
- ⏳ **Phase 4** — Ops console CRUD
- ⏳ **Phase 5** — Scheduling
- ⏳ **Phase 6** — Field app
- ⏳ **Phase 7** — Reviews + bonuses
- ⏳ **Phase 8** — Chat
- ⏳ **Phase 9** — Seed data
- ⏳ **Phase 10** — Pre-launch hardening
