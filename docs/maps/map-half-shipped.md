# Half-shipped inventory — cleanops (Sollos 3), read-only, 2026-10-28

Repo: `C:\Users\musil\Documents\BPMMEDIACO\cleanops` at `b9075e4` (main). Nothing was edited.
All paths below are relative to that root unless absolute.

Known items confirmed with pointers:

| Known item | Confirmed at |
| --- | --- |
| Job-state rules in shadow unless `JOB_STATE_WRITE=1`, no exit date | `src/lib/job-sync.ts:48-50` (`jobSyncMode()`), only caller `src/lib/job-sync.ts:348`; header comment lines 22-27 says "a week of those rows ... is the test before the flip" with no date; `scripts/shadow-morning-check.ts:71` prints the flag |
| `scripts/shadow-morning-check.ts` meant to run from an 8 AM task that never existed | commit `30d814a` body: "A scheduled task runs it at 8 AM and writes to reports/"; `reports/` does not exist; `schtasks /query` has no matching task; the desktop scheduled-tasks list has only `weekly-sollos-changelog` (Fri 07:07) |
| Help does not mention "I'm here" / "I'm done" / manager "Needs you" list; timesheets guide still says "Start job"/"clock in" | `src/content/help/timesheets-and-payroll.ts:12` ("**Start job** only appears..."), `:2` ("cleaners clock in and out"); `src/content/help/getting-around.ts:5` ("clock in and out"); zero help files match `I'm here|I'm done`; "Needs you" appears only in `feedback.ts:22` (a different "Needs your answer" state) and `automations.ts:31` (unrelated); the live buttons are at `src/app/field/jobs/[id]/job-actions.tsx:86,116,175,190` and `src/app/field/jobs/job-card-complete.tsx:90-93` |
| `ai_conversations` written, never read | only writer `src/app/api/ai-chat/route.ts:280`; no `.select` anywhere in src/scripts; the code itself says so at `route.ts:245` and `src/components/ai-assistant/ai-widget.tsx:199` |

---

## 1. Feature flags and env-gated behaviour

Schema: `src/lib/env.ts` (229 lines, Zod). All flags are optional; default is "off". The `is*Configured()` helpers are at `env.ts:166-229`.

| Flag / env read | Where read | Default (unset) | Other branch | Both branches still meant to exist? |
| --- | --- | --- | --- | --- |
| `JOB_STATE_WRITE` | `src/lib/job-sync.ts:49`; `scripts/shadow-morning-check.ts:71` | **shadow**: computes state, writes one `audit_log` `state_check` row on disagreement, touches nothing (`job-sync.ts:22-27`) | `"1"` → write mode stores status, logs, drafts invoice on done | No — shadow is a temporary test harness; the old direct status writers "keep running alongside" (two systems answer one question). `docs/finish-plan-2026-10-28.md` slice 8 targets Nov 7 and then deleting "the old status-writing paths and the flag". |
| `STRIPE_ENABLED` | `src/lib/stripe.ts:23` (`isStripeEnabled`), `env.ts:166`; callers `src/app/api/stripe/{checkout,portal,webhook}/route.ts`, `src/app/app/layout.tsx:68`, `src/app/app/settings/billing/page.tsx:135`, `src/lib/subscription.ts:201`, `src/lib/stripe-refunds.ts:54`, `src/lib/stripe.ts:354,410,434` | **off**: platform billing never charges; `subscription.ts:201` returns `true` (everyone allowed); Settings → Billing shows amber "Billing is scaffolded but not yet enabled in this environment" (`billing/page.tsx:174`) | `"true"` → checkout, portal, trial gate, SMS overage metering | Yes, but the "scaffolded" banner is owner-visible on a live product |
| `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_GROWTH`, `STRIPE_PRICE_SMS_OVERAGE` | `src/lib/stripe.ts:70,72,80,81,353` | tier not purchasable / overage not metered | price ids map to plans | Yes (depends on STRIPE_ENABLED) |
| `TWILIO_ENABLED` (+ SID/token/from) | `src/lib/twilio.ts:41`, `env.ts:206` | **off**: `sendSms` no-ops; `provisionOrgNumber` takes the **stub path** and stores `+15005550006` with sid `SIMULATED` (`src/lib/twilio-provision.ts:103-108`) | `"true"` → real Twilio buy + send | Stub path is dev-only but **leaks into prod data**: `provisionOrgNumber` returns early for any org that already has a number, SIMULATED included (`twilio-provision.ts:90-97`), so an org that enabled SMS before Twilio went live keeps the test number forever. The Settings → SMS copy "A real number is assigned automatically once Twilio is connected" (`src/app/app/settings/sms/sms-settings-form.tsx:104-106`) is not true in code. |
| `CLIENT_EMAILS_PAUSED` | `src/lib/email.ts:421` (`isClientEmailPaused`); callers `email.ts:636`, `src/lib/automations.ts:2298,2711`, `src/app/app/contracts/actions.ts:263`, `src/app/client/(portal)/request/actions.ts:124` | **off** | `"true"` → every org→client automated email is blocked; contracts action shows "share it manually for now" (`contracts/actions.ts:264`) | Yes — incident kill switch |
| `INVOICE_EMAILS_UNPAUSED` | `src/lib/email.ts:449`; only caller `src/lib/automations.ts:3903` (`pauseExempt`) | **off** | `"true"` → invoice auto-send bypasses the pause above | Yes (incident sub-switch); **not declared in env.ts schema** |
| `CLIENT_SMS_PAUSED` | `src/lib/sms.ts:88`; caller `sms.ts:235` | **off** | `"true"` → client-facing SMS blocked, employee SMS still sends | Yes; **not declared in env.ts schema** |
| `SQUARE_ENVIRONMENT` | `src/lib/square.ts:46` + `assertSquareEnvForMoneyPath` `:58-66` | **sandbox** (also when misspelled) | `production` | Yes, but a prod deploy without the var throws on the money path — intentional loud failure |
| `QUICKBOOKS_ENVIRONMENT` | `src/lib/quickbooks.ts:36-46` | **sandbox** API base | `production` | Yes; memory says production key switch is still Brian's step → QuickBooks is effectively sandbox-only today |
| `VERCEL_ENV` / `NODE_ENV` | `square.ts:60-61`, cookie `secure` flags (`src/lib/auth.ts:441`, `src/app/join/page.tsx:110`, `src/app/field/profile/actions.ts:129`, `settings/integrations/google-calendar-actions.ts:35`), Sentry env | dev | prod | Yes |
| `CRON_SECRET` | `src/lib/cron-auth.ts:17`, `src/lib/abuse-guard.ts:179` | **Bearer check skipped** (`env.ts:85-87` calls this "caller-controlled risk") | header required | Yes, but the unset branch is a public-trigger hole if the var ever drops |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | `src/lib/turnstile.ts:16,25` | signup CAPTCHA layer off | on | Yes |
| `RESEND_VERIFIED_DOMAINS` | `src/lib/email.ts:259` | platform default domain only | comma list of verified sender domains | Yes; **not declared in env.ts schema** |
| `INTEGRATION_ENCRYPTION_KEY_PREVIOUS` | `src/lib/crypto.ts:78-81` | no key rotation | old keys tried for decrypt | Yes; not in env.ts schema |
| `GOOGLE_PLACES_API_KEY` | `src/app/api/places-autocomplete/route.ts:47` | address autocomplete 500s with console error | on | Yes; not in env.ts schema |
| `ANTHROPIC_API_KEY` | ai-chat route | assistant "isn't available right now" | on | Yes; not in env.ts schema |
| `NEXT_PUBLIC_APP_URL` / `APP_URL` | `src/app/api/sms/inbound/route.ts:54-55`, `src/lib/twilio-provision.ts:49-50` | falls back to prod URL | override | Duplicate of `NEXT_PUBLIC_SITE_URL` (66 reads); neither in env.ts schema |
| `NEXT_PUBLIC_BUILD_SHA` | `src/components/update-beacon.tsx:22`, set in `next.config.ts:88` | — | — | Yes |
| `SUPABASE_URL_NEW` / `SUPABASE_SERVICE_ROLE_KEY_NEW` | `scripts/import-all-data.ts:16`, `scripts/detect-missing-columns.ts:11` | scripts abort | — | One-off project-migration scripts (see §5) |
| `process.env.FOO` | `src/lib/env.ts:10` | doc comment only | — | n/a |
| Per-org automation master switch | `src/lib/automation-defaults.ts:72` ("does nothing until the owner turns on the master switch") | all automations off for a new org | — | Yes, by design |

Dead flag-adjacent code: `src/lib/stripe.ts:453-465` `verifyStripeSignaturePlaceholder` — "legacy export kept for the old placeholder import", zero callers. Delete.

---

## 2. Marker comments (TODO / FIXME / for now / not yet / deferred / parked / phase 2)

There are **no** `TODO`, `FIXME`, `HACK` or `XXX` comments in `src/` or `scripts/`. What exists is softer language. User-facing strings and "not yet accepted/paid" state labels are excluded.

| Area | File:line | What it says / means |
| --- | --- | --- |
| Timesheets | `src/app/app/timesheets/page.tsx:306-315` | "For now we treat all as hourly since pay_type column may not exist yet" — `pay_type` has existed since migration `20260413040000_payroll_pto.sql:9` with a CHECK (hourly/flat/percent). Timesheets hardcodes `pay_type: "hourly"` for every employee (`:315`, `:513`). No UI writes `pay_type` (grep: only `src/app/app/employees/engagement-field.tsx:32` mentions it, in a comment). The help article `timesheets-and-payroll.ts:6` describes flat/percent pay types as if they work. |
| Scheduling | `src/app/app/scheduling/actions.ts:188` | "follow-up; for now the dispatch grid's visual conflict ring covers" — server-side double-booking guard not implemented, UI ring only |
| Scheduling | `src/app/app/scheduling/page.tsx:142` | `// unused` return value |
| Scheduling | `src/app/app/scheduling/dispatch-grid.tsx:635` | "Unused but keeps `date` on the hook dependency if we later want..." |
| Invoices | `src/app/app/invoices/[id]/page.tsx:73` | line items "read-only for now" on the invoice view (edit page exists, so this is fine, just stale wording) |
| Invoices / generated types | `src/app/app/invoices/[id]/page.tsx:189,205,215`, `src/app/app/contracts/[id]/edit/page.tsx:53`, `src/app/i/[token]/page.tsx:86,121`, `src/lib/invoice-send.ts:69`, `src/lib/sms.ts:61` | Seven "columns not yet in generated types — fetch separately" workarounds. `pnpm db:types` was never re-run after those migrations; every one is a second query that could be one. |
| Contracts | `src/app/app/contracts/actions.ts:264` | "share it manually for now" when `CLIENT_EMAILS_PAUSED` |
| Security | `src/app/app/profile/security/page.tsx:16` | MFA "for now, voluntary" — no enforcement path for owners |
| Clients | `src/app/app/clients/clients-table.tsx:32` | "Reserved for row-level edit affordances; currently unused" |
| Estimates | `src/lib/estimate-pdf.ts:54` | parameter "kept for signature compatibility with the Chromium era; unused" |
| Holidays | `src/lib/holidays.ts:73` | substitute-day handling "acceptable for now" |
| SMS inbound (Phase 2) | `src/lib/twilio-provision.ts:5,46,159` | "Phase 2 can route inbound", webhook URL "(Phase 2)", "wiring the inbound webhook now for Phase 2". Phase 2 is partly built: `src/app/api/sms/inbound/route.ts:103-106` handles STOP/START/HELP and **drops every real reply with `twiml(null)`** — a client texting "running late" is acked and discarded, stored nowhere, shown to nobody. `docs/sms-phase1-spec.md` is the spec. |
| SMS stub | `src/lib/twilio-provision.ts:103` | "Stub path: Twilio not live → simulate" — see §1 |
| Email cap | `src/lib/email.ts:467`, `src/lib/crew-accommodations.ts:14` | "table not yet migrated" fallbacks that allow the action when the table is missing — fine as fail-open guards but they hide a missing migration |
| Payments settings | `src/app/app/settings/payment-methods/page.tsx` header | "fallback for when online payments aren't wired up yet (Phase 12 Part 1)" — stale, Stripe Connect and Square are wired |
| Dashboard | `src/app/app/page.tsx:163`, `src/app/app/setup/setup-checklist.tsx:376` | "Skip setup for now" — product copy, fine |
| Assistant | `src/components/ai-assistant/ai-widget.tsx:112` | "bottom-5 parked this button squarely on its More tab" — layout note, fine |
| Scripts | `scripts/replay-job-state.ts:144` | prints "closed_at column: not yet" when the column is missing |

---

## 3. Tables and columns with no reader or no writer

### Tables created by migrations after 2026-08-01 (15)

Method: `.from("<table>")` occurrences in src/scripts, with `.select` vs `.insert/.update/.upsert/.delete` in the following 4 lines.

| Table | Migration | Readers | Writers | Verdict |
| --- | --- | --- | --- | --- |
| `client_job_requests` | 20260806020000 | 6 selects (portal, bookings/requests, field job page, lead-conversion) | 7 writes | live |
| `client_properties` | 20260810010000 | 5 (bookings/new, options, clients/[id]) | 3 (`property-actions.ts`) | live, **but** `default_checklist_template_id` (migration line 60-63) is stored by `property-actions.ts:84` and resolved by `src/lib/client-properties.ts:81` `checklistTemplateFor()`, which has **zero callers**. The DB triggers `apply_client_checklist_on_booking` / `apply_service_checklist_on_booking` (`20261024010000`) never mention `client_properties`. Property-level checklist is a write-only field with a UI. |
| `subcontractor_pay_runs` / `subcontractor_pay_items` | 20260814010000 | 10 / 7 | 5 / 3 | live |
| `invoice_tips` | 20260819020000 | 12 | 9 | live |
| `hiring_docs` | 20260829020000 | 3 | 3 | live |
| `client_documents` | 20260901020000 | 3 | 4 | live |
| `applicant_interviews` | 20260901040000 | 3 | 3 | live |
| `network_contacts` | 20260902010000 | 3 | 3 | live |
| `feedback_items` / `feedback_replies` | 20260902070000 | 3 / 2 | 2 / 1 | live (owner notes only 2 items since Sep 3 — adoption, not code) |
| `client_emails` | 20260904010000 | 2 | 1 | live |
| `org_email_counters` | 20260913010000 | 1 (`src/lib/abuse-guard.ts`) | via RPC `bump_org_email_counter` (`src/lib/email.ts`) | live |
| `booking_prepayments` | 20261015020000 | 3 | 5 | live |
| `needs_you_state` | 20261029010000 | 4 (`needs-you.ts`, `needs-you-alerts.ts`, `automations.ts`, morning script) | 3 (`needs-you-actions.ts`, alerts) | live; **migration filename is dated 2026-10-29, after today** (committed 2026-10-27 in `52d417d`) — see note below |
| `ai_conversations` | 20260516010000 (older, included because asked) | **0** | 1 (`src/app/api/ai-chat/route.ts:280`) | **write-only. Delete the insert and the table, or build the review screen.** |

SQL-only objects created after 08-01 with no src reference (expected, used by RLS/triggers): `is_booking_crew`, `booking_wall_clock_local`, `bookings_keep_wall_clock`, `current_user_membership_ids`, `feedback_bump_activity`, the insider guard functions. RPCs with src callers: `app_shell_counts`, `bump_org_email_counter`, `report_job_profitability`, `report_cleaner_scorecard`, `purge_org_audit_log`, `purge_org_audit_actors`, `backfill_service_checklist`, `backfill_client_checklist`.

### Columns added by migrations after 2026-09-15

| Column | Migration | Written by | Read by | Verdict |
| --- | --- | --- | --- | --- |
| `organizations.send_approval_requested_at` | 20260915020000 | `src/lib/email.ts:591` | `email.ts:481,518` | live (zero-cap approval ping; the zero-cap default was reverted the same day in 20260915030000, so this only fires for orgs capped by hand) |
| `bookings.is_free` | 20260925010000 | booking form/actions | 20 files incl. job-state, needs-you | live |
| `booking_series.crew` (jsonb) | 20261007010000 | `src/app/app/bookings/actions.ts` via `crewFromForm` | `src/lib/series-crew.ts`, `automations.ts:4177` extend-series | live |
| `job_offers.replaces_membership_id` | 20261015010000 | `src/app/app/freelancers/actions.ts`, offer form | `src/app/claim/[token]/actions.ts` | live |
| `checklist_*.kind` (item/section/subsection) | 20261024010000 | `src/app/app/checklists/actions.ts:76` | `booking-checklist.tsx`, `checklists/page.tsx:56`, `actions.ts:492` | live |
| `bookings.closed_at` | 20261028010000 | `src/lib/close-job.ts`, `bookings/actions.ts:1541,2877`, API v1 | job-state, job-sync, needs-you, scripts (41 lines) | live |
| `bookings.closed_by` | 20261028010000 | `close-job.ts:49`, `bookings/actions.ts:1541,2877`, `api/v1/bookings/[id]/route.ts:187` | `src/lib/job-sync.ts:241-252` (actor name for the audit line) only | live, read in one place |
| `bookings.time_set_by_hand_at` | 20261030010000 | `bookings/actions.ts`, `scheduling/actions.ts`, `needs-you-actions.ts` (Keep), API v1 | `src/lib/series-drift.ts`, `needs-you.ts`, `scripts/series-drift-report.ts` | live |
| `bookings.scheduled_local` / `scheduled_tz` | 20261030020000 | `scheduled-local-job.ts`, `scheduling/actions.ts`, cron `rederive-times` | same + DB trigger `bookings_keep_wall_clock` | live |
| `needs_you_state.snoozed_until` | 20261029010000 | `needs-you-actions.ts` | `needs-you.ts`, morning script | live |
| `needs_you_state.snoozed_by` | 20261029010000 | `needs-you-actions.ts:60` | **nobody** | write-only (audit-ish; harmless, but nothing shows who snoozed) |
| `needs_you_state.notified_at` | 20261029010000 | `needs-you-alerts.ts` | `automations.ts`, morning script | live |
| `time_entries.engagement_snapshot` | 20260808010000 (asked about) | `timesheets/actions.ts:1094` | `payroll/page.tsx:230-385`, `timesheets/actions.ts:1148`, `payroll/contractors/run-actions.ts:14` | live |
| `memberships.pay_type` | 20260413040000 (older) | **nobody in src** (grep: no insert/update carries it) | `timesheets/page.tsx` hardcodes `"hourly"` instead of reading it | **column with a CHECK constraint, a help paragraph, and no writer** |

Note on migration dates: `20261029010000_needs_you_state.sql`, `20261030010000_booking_time_set_by_hand.sql`, `20261030020000_booking_wall_clock.sql` carry timestamps 1-2 days in the future (committed Oct 27-28). Any migration created on Oct 28-29 with a true timestamp will sort *before* them. Whether all three are applied in production cannot be checked from the repo.

---

## 4. Help coverage

Help library: `src/content/help/index.ts` — 12 articles in 4 sections (Start here, Day to day, Money, Website & portal). The assistant ingests these at request time (`help-section-feeds-assistant` memory), so a stale article is a wrong answer from the assistant too.

### Articles describing UI that no longer exists

| Article:line | Says | Reality |
| --- | --- | --- |
| `timesheets-and-payroll.ts:12` | "**Start job** only appears on a job within four hours of its start ... **Accept** in place of Start until the lead clocks in, after which anyone on the crew can start" | Buttons are **I'm here** / **I'm done** (`src/app/field/jobs/[id]/job-actions.tsx:11` "The only two things a cleaner says about a job"); "I'm done" is a two-tap arm (`:43,190`); job cards carry the taps directly (`job-card-complete.tsx`); offline taps are queued (`src/app/field/tap-queue-flusher.tsx`) |
| `timesheets-and-payroll.ts:2` | "cleaners clock in and out" | wording; the non-job Clock screen (`src/app/field/clock/clock-card.tsx:393,411` still says "Clock in / Clock out") is a different screen from the job taps — the article conflates them |
| `timesheets-and-payroll.ts:6` | pay type "hourly for nearly everyone; flat per entry; percent" | no UI sets `pay_type`; timesheets treats everyone as hourly (§2) |
| `getting-around.ts:5` | field app: "clock in and out, tick checklists, upload photos" | missing I'm here / I'm done, Shifts (accept), Hours, Pay, Availability, Time off, Chat, Feed, Training tabs |
| `getting-around.ts:24` | dashboard top "is today: jobs, revenue, who's working ... something money-shaped needs fixing" | the dashboard now leads with the **Needs you** list (`src/app/app/needs-you.tsx`, `needs-you-buttons.tsx`: Still coming / Still working / Restore / Keep) — not described anywhere |
| `feedback.ts:22,28` | "Needs your answer" | this is the feedback board state, not the dashboard list; a search for "Needs you" in Help lands here and misleads |

### Feature areas vs articles (phrase match across the 12 bodies)

Field app (`src/app/field/*`):

| Screen | Covered? |
| --- | --- |
| Jobs / Today (`jobs/`) — I'm here / I'm done, two-tap, offline queue | **No** (described with old names only) |
| Job page — photos, checklist, facts line | partial (`checklists.ts`) |
| Shifts (accept/confirm upcoming) (`shifts/`) | mentioned in `timesheets-and-payroll.ts:12` as "Accept"; no article |
| Clock (non-job clock, categories) (`clock/`) | **No** |
| Hours (`hours/`) | **No** (only "their hours" in hiring/reports context) |
| Pay (`pay/`) | **No** |
| Availability (`availability/`) | mentioned in `bookings.ts`, `hiring.ts`; no field-side explanation |
| Time off (`time-off/`) | mentioned (`bookings`, `hiring`, `timesheets`) |
| Chat (`chat/`) | mentioned in `getting-around` only |
| Feed (`feed/`) | **No** (only `feedback.ts`) |
| Training (`training/`) | mentioned in `hiring.ts`, `getting-around.ts` |
| Profile / Security (MFA) | **No** |

Manager app (`src/app/app/*`):

| Area | Covered? |
| --- | --- |
| Dashboard Needs you | **No** |
| Bookings, series, requests, offers | Yes (`bookings.ts`) |
| Calendar / Scheduling (dispatch grid, drag) | mentioned only (`getting-around`, `leads-and-clients`); no article; keyboard shortcuts live only in an `alert()` (`scheduler-shell.tsx:195`) |
| Clients, leads, properties, documents, emails, portal invite | Yes (`leads-and-clients.ts`, `client-portal.ts`) |
| Checklists (service/client/manual; sections) | Yes, but property level is "unapplied" (§3) |
| Estimates, contracts | mentioned across articles; no article |
| Invoices, recurring invoices, prepayments, tips | Yes (`invoicing.ts`) |
| Timesheets, payroll, contractor statements, final settlement | Yes (`timesheets-and-payroll.ts`, `hiring.ts`) |
| Bonuses / bonus rules | mentioned |
| Reports | Yes |
| Employees, applicants, hiring, training, network | Yes (`hiring.ts`, network mentioned) |
| Freelancers / on-call bench / offers / payables | one mention (`timesheets-and-payroll`) |
| Tasks (`tasks/`) | **No** |
| Announce (`announce/`) | **No** |
| Inventory (`inventory/`) | **No** |
| Packages (`packages/`) | **No** |
| Reviews / GBP review asks | Yes (`automations.ts`) |
| Feed, Chat, Notifications | partial |
| Feedback board | Yes |
| Settings: automations, thresholds, intake forms, email, SMS, branding | Yes/partial (`automations.ts`, `website-forms.ts`) |
| Settings: integrations, payment methods, invoicing, currency, timezone, tips, members, data export, audit log, API keys, webhooks, billing | **No** (integration mentioned twice in passing) |
| Client portal | Yes |

---

## 5. Scripts and what runs them

`scripts/` (13 files). Runners checked: `vercel.json` crons (38, none run a script), `package.json`, `.github/workflows/ci-guards.yml`, Windows Task Scheduler, the desktop scheduled-tasks list, git log.

| Script | Lines | Scheduled / referenced by | Note |
| --- | --- | --- | --- |
| `shadow-morning-check.ts` | 216 | **nothing** | commit `30d814a` says "A scheduled task runs it at 8 AM and writes to reports/"; no task, no `reports/` dir. `finish-plan` wants it as a Vercel cron that emails. |
| `series-drift-report.ts` | 159 | nothing (manual) | commit `867c873`; writes `reports/series-drift-<date>.md`; the same list is on the dashboard, script adds one extra evidence column |
| `replay-job-state.ts` | 170 | nothing (manual) | shadow-exit evidence (`finish-plan` slice 7) |
| `validate-cron-schedules.ts` | 152 | `package.json` `cron:check`; CI `ci-guards.yml:33` | **Guard is stale and CI is red on every push**: it rejects sub-daily crons (Hobby rule) but `vercel.json` has `5 * * * *`, `0 * * * *`, `*/30 * * * *`, `30 */4 * * *`, `45 */4 * * *`; local run exits 1; `gh run list --workflow=ci-guards.yml` shows the last three main pushes **failed**. The finish-plan's "branch protection requiring CI" would block every push until this is fixed or deleted. |
| `seed.ts` | 882 | `package.json` `seed` | dev |
| `wipe.ts` | 261 | `package.json` `wipe` | dev |
| `export-all-data.ts` | 194 | nothing | one-off Supabase project migration (`73ff268`); needs `SUPABASE_URL_NEW` |
| `export-supplement.ts` | 192 | nothing | same one-off |
| `import-all-data.ts` | 304 | nothing | same one-off |
| `verify-export.ts` | 267 | nothing | same one-off |
| `detect-missing-columns.ts` | 78 | nothing | same one-off |
| `verify-chat-readiness.ts` | 128 | nothing | diagnostic from `5f380e7` |
| `verify-dm-health.ts` | 112 | nothing | diagnostic |
| `scripts/export/` (dir, gitignored) | — | — | contains a full JSON data export + `_auth_users.json` + storage files on disk from the old project |

Desktop scheduled task that does exist: `weekly-sollos-changelog` (Fri 07:07, last ran 2026-10-16 — it missed Oct 23, matching the finish-plan note). The matching Vercel cron `/api/cron/product-changelog` (Fri 15:00 & 16:00 UTC) only sends entries the desktop task wrote.

Also: `.claude/worktrees/adoring-banach-13c23f` is a stale detached worktree at `4d7afb2` with a full copy of the repo; branch `claude/adoring-banach-13c23f` still exists locally. `git worktree list` shows it.

---

## 6. Integrations

Settings page: `src/app/app/settings/integrations/page.tsx` — three states per card: "Coming soon" (platform env missing, `:70,318`), "Not connected", "Connected". Card definitions `:208-258`. A "request an integration" form emails support (`integration-request-form.tsx`, `request-actions.ts`). `last_error` is shown on the card (`:424-430`) but a connection whose status flips away from `active` is filtered out of the query (`:107-111`) and therefore disappears rather than prompting a reconnect (the known "integration disconnect silent failure").

| Provider | Settings UI | Sync / money code | Webhook | Gate | Verdict |
| --- | --- | --- | --- | --- | --- |
| Stripe Connect (invoice payments) | card + `stripe-connect-actions.tsx` (disconnect) | `src/lib/stripe-connect.ts` (453), `stripe-invoice-payment.ts` (543), `stripe-refunds.ts` (177), invoice page payment-link button | `src/app/api/integrations/stripe/webhook/route.ts` | `isStripeConnectConfigured()` | production-complete (memory: both endpoints carry all events since 9/14) |
| Stripe platform billing | `settings/billing/page.tsx` | `src/lib/stripe.ts`, `subscription.ts` | `src/app/api/stripe/webhook/route.ts` | `STRIPE_ENABLED` | **scaffolded, off**; owner sees the amber banner |
| Square | card; connect/disconnect routes | `src/lib/square.ts` (700), `square-invoice-payment.ts`, `square-refunds.ts` | `api/integrations/square/webhook/route.ts` | `isSquareConfigured()`, `SQUARE_ENVIRONMENT` defaults sandbox, money-path assert `square.ts:58` | code complete, **zero live usage**; memory: Square dashboard checklist still owed |
| QuickBooks Online | card; `quickbooks-actions.ts` connect/disconnect | `src/lib/quickbooks.ts` (1004), cron `quickbooks-reconcile` (every 4h) | none (pull/reconcile) | `isQuickBooksConfigured()`, `QUICKBOOKS_ENVIRONMENT` defaults sandbox | **sandbox-only** until production keys; GST 5% untestable in the US sandbox (memory) |
| Sage Business Cloud | card; `sage-actions.ts` (connect, tax region, account map), `sage-accounts.tsx`, `sage-tax-region.tsx`; invoice page `sync-sage-button.tsx` | `src/lib/sage.ts` (2486), cron `sage-reconcile` | none | `isSageConfigured()` | production-complete in code, **used by the test org only**; Svit is on Sage 50 (no API) |
| Google Calendar | card; `google-calendar-actions.ts` connect/disconnect; per-member calendars | `src/lib/google-calendar.ts` (2599), `booking-calendar-sync.ts`, crons `member-calendar-reconcile`, `org-calendar-reconcile`, `gcal-prune`, dryRun options `:712,1075` | none | `isGoogleCalendarConfigured()` | production-complete; disconnect-detection deferred pending Google compliance (memory) |
| Twilio (SMS) | `settings/sms/page.tsx` + form; usage meter | `src/lib/twilio.ts`, `sms.ts`, `twilio-provision.ts`; inbound `api/sms/inbound/route.ts` | inbound webhook | `TWILIO_ENABLED` | outbound live (memory). **Half-shipped**: (a) simulated-number orgs never upgraded (§1); (b) inbound real replies dropped (`route.ts:103-106`) — "Phase 2" in `twilio-provision.ts` |
| Resend (email) | `settings/email/page.tsx` (sender verification `api/verify-sender`) | `src/lib/email.ts`, `email-templates.ts` (2166), suppression | `api/webhooks/resend/route.ts` | `RESEND_API_KEY`, `RESEND_VERIFIED_DOMAINS` | production-complete; `INVOICE_EMAILS_UNPAUSED`/`CLIENT_EMAILS_PAUSED` are incident switches |
| Outgoing webhooks (Settings → Webhooks) | `settings/webhooks/page.tsx:32-39` offers booking.created/completed/cancelled, invoice.created/**sent**/paid, client.created | `src/lib/webhooks.ts` `dispatchWebhookEvent` | — | — | **Half-shipped**: dispatch is called only from `src/app/api/v1/**` routes and `find-or-create-client.ts:130`. A booking created, completed or cancelled in the UI, or an invoice drafted/paid in the UI, **never fires a webhook**. `invoice.sent` is offered in the UI but is not even in `WebhookEventType` (`webhooks.ts:20-31`) — it can never fire. |
| Turnstile | signup | `src/lib/turnstile.ts` | — | optional | fine |
| Web push | `push-prompt.tsx` | `src/lib/push.ts` | — | VAPID keys | fine |

---

## 7. UI dead ends

Few. No `href="#"`, no empty `onClick`, no `console.log` in TSX, no "coming soon" buttons besides the integrations badge.

| File:line | What |
| --- | --- |
| `src/app/app/settings/integrations/page.tsx:318` | "Coming soon" badge on any provider whose env vars are missing in that environment — on prod this is QuickBooks/Square only if keys are absent; otherwise it is a dev artefact |
| `src/app/app/settings/billing/page.tsx:174` | "Billing is scaffolded but not yet enabled in this environment. Set STRIPE_ENABLED=true" — owner-visible on prod |
| `src/app/app/settings/sms/sms-settings-form.tsx:101-107` | "Test number — Twilio isn't live yet ... assigned automatically once Twilio is connected" — shown to any org whose `sms_number_sid` is `SIMULATED`; the promise is not implemented (§1) |
| `src/app/app/settings/webhooks/page.tsx:36` | `invoice.sent` option that can never fire (§6) |
| `src/app/app/scheduling/scheduler-shell.tsx:195` | `?` shortcut help is a browser `alert()` (eslint-disabled), not a UI |
| `src/app/app/settings/api-keys/api-keys-client.tsx:48` | errors shown with `alert(result.error)` instead of the toast system used everywhere else |
| `src/app/app/clients/[id]/properties-card.tsx` + `property-actions.ts:48,84` | property form field "default checklist" saves to a column nothing reads (§3) |
| `src/app/app/freelancers/payables/page.tsx`, `payables/[contactId]/page.tsx` | legacy redirects to `/app/payroll/contractors` — intentional, keep or delete the routes |
| `src/app/field/page.tsx` | redirect to `/field/jobs` — fine |
| `src/app/app/leads/page.tsx:104`, `feedback/page.tsx:217` | "Nothing here yet" empty states — fine |
| `src/app/app/profile/security/page.tsx:16` | MFA voluntary; no "require MFA for owners" switch exists |
| `src/app/app/settings/payment-methods/page.tsx` header | describes itself as the fallback "when online payments aren't wired up yet (Phase 12 Part 1)" — stale copy |
| `src/components/ai-assistant/ai-widget.tsx:199` | comment documents the earlier dead end ("Feedback is shared with the Sollos team" was false); the fix (email support on a 🚩 flag, `ai-chat/route.ts:249-270`) is live, but the `ai_conversations` insert underneath it remains |

No `src/app/**/page.tsx` renders a placeholder; the 10-line marketing pages are data-driven wrappers around `src/components/landing-page`.

---

## 8. Tests

67 test files (`src/**/*.test.ts` + `test/`); 55 of them are `src/lib/*.test.ts`. Finish-plan says 795 tests pass. `pnpm test` runs in CI job "Unit tests" (`ci-guards.yml:36`), but the sibling "Validate cron schedules" job is red (§5).

### `src/lib` modules over 150 lines with no sibling `.test.ts` (55)

| Lines | Module | Lines | Module |
| --- | --- | --- | --- |
| 8109 | `automations.ts` | 264 | `estimate-pdf.ts` |
| 2599 | `google-calendar.ts` | 252 | `webhooks.ts` |
| 2486 | `sage.ts` | 248 | `validators/bookings.ts` |
| 2166 | `email-templates.ts` | 247 | `twilio-provision.ts` |
| 1004 | `quickbooks.ts` | 246 | `chat-actions.ts` |
| 827 | `tenant-data.ts` | 242 | `contractor-run-create.ts` |
| 790 | `subcontractor-payables.ts` | 239 | `booking-coverage.ts` |
| 724 | `invoice-send.ts` | 234 | `chat-data.ts` |
| 707 | `email.ts` | 230 | `push.ts` |
| 700 | `square.ts` | 229 | `env.ts` |
| 543 | `stripe-invoice-payment.ts` | 225 | `client-offboarding.ts` |
| 531 | `sms.ts` | 204 | `subscription.ts` |
| 465 | `stripe.ts` | 198 | `invoice-hours-check.ts` |
| 462 | `job-sync.ts` | 196 | `simple-markdown.tsx` |
| 453 | `stripe-connect.ts` | 192 | `invoice-pdf.ts` |
| 448 | `payroll-run-create.ts` | 189 | `validators/common.ts` |
| 445 | `auth.ts` | 183 | `square-invoice-payment.ts` |
| 433 | `twilio.ts` | 182 | `square-refunds.ts`, `validators/clients.ts` |
| 337 | `final-settlement.ts` | 177 | `stripe-refunds.ts` |
| 333 | `needs-you.ts` | 176 | `booking-prepayments.ts` |
| 327 | `member-offboarding.ts` | 175 | `lead-alerts.ts` |
| 320 | `product-changelog.ts` | 173 | `unavailability-notice.ts` |
| 317 | `crew-hours.ts` | 169 | `invoice-tip-recipients.ts` |
| 301 | `notify.ts` | 168 | `invitation-claim.ts` |
|  |  | 167 | `invoice-line-items.ts`, `feed-actions.ts` |
|  |  | 161 | `crypto.ts` |
|  |  | 155 | `stray-punch-match.ts` |
|  |  | 152 | `needs-you-alerts.ts`, `audit.ts` |

The pure decision modules (job-state, needs-you-items, series-drift, scheduled-local, booking-status, etc.) do have tests; the untested set is the I/O and integration layer. `job-sync.ts` (the shadow/write seam) and `needs-you.ts` (the loader) are the two most consequential untested files.

### Server-action files

- Files named exactly `actions.ts`: **60**, totalling **22,356 lines**, **0** with a test (no `*actions*.test.ts` exists).
- Including `*-actions.ts` variants (photo-actions, needs-you-actions, run-actions, email-actions, ...): 82 files, 26,225 lines, 0 tests.
- Largest: `src/app/app/bookings/actions.ts` 3,870; `timesheets/actions.ts` 1,975; `invoices/actions.ts` 1,762; `employees/actions.ts` 1,182; `field/jobs/actions.ts` 1,061 (the I'm here / I'm done path).

---

## Ranked: 15 items most worth finishing or deleting first

Ranked by how visible each is to a cleaning company using the app every day.

| # | Item | Finish or delete | Pointers |
| --- | --- | --- | --- |
| 1 | Help articles describe buttons that no longer exist (Start job / clock in) and never mention I'm here, I'm done, or the Needs you list; the assistant repeats the stale text | **Finish** (rewrite `timesheets-and-payroll.ts:2-12`, `getting-around.ts:5,24`; add a field-app article) | §4 |
| 2 | Job-state rules in shadow; two systems still write `bookings.status` | **Finish** (flip `JOB_STATE_WRITE`, then delete the old writers and the flag) | `src/lib/job-sync.ts:49`; finish-plan slices 7-8 |
| 3 | Inbound SMS: a client's real reply is acked and discarded | **Finish** (store + surface) or **delete** the inbound number promise | `src/app/api/sms/inbound/route.ts:103-106`; `twilio-provision.ts:5,46,159` |
| 4 | Morning check never scheduled; `reports/` never written | **Finish** as a Vercel cron that emails | `scripts/shadow-morning-check.ts`; commit `30d814a` |
| 5 | Settings → Webhooks promises events the UI never fires; `invoice.sent` cannot fire at all | **Finish** (dispatch from the server actions) or **delete** the UI-only options | `src/lib/webhooks.ts:20-40`; callers only in `api/v1/**`; `settings/webhooks/page.tsx:32-39` |
| 6 | `pay_type` column: CHECK constraint, help paragraph, no writer; Timesheets hardcodes hourly | **Finish** (employee form field + timesheets read) or **delete** the column and the help sentence | `timesheets/page.tsx:306-315,513`; `help/timesheets-and-payroll.ts:6` |
| 7 | Property-level default checklist is saved and never applied | **Finish** (call `checklistTemplateFor` from booking creation / trigger) or **delete** the form field | `client-properties.ts:81`; `property-actions.ts:84`; migration `20260810010000:60-63` |
| 8 | Twilio simulated numbers persist after go-live; SMS settings copy promises an automatic upgrade that does not happen | **Finish** (re-provision when `sid === "SIMULATED"` and Twilio is live) | `twilio-provision.ts:90-97,103-108`; `sms-settings-form.tsx:101-107` |
| 9 | CI "Validate cron schedules" job is red on every push (Hobby-plan guard vs hourly crons) | **Delete** the guard or make it plan-aware; otherwise branch protection can never be enabled | `scripts/validate-cron-schedules.ts`; `ci-guards.yml:33` |
| 10 | `ai_conversations` write-only table | **Delete** the insert (and table) — the 🚩 flag already emails support | `api/ai-chat/route.ts:280` |
| 11 | Billing "scaffolded" banner visible to owners | **Finish** (enable) or **delete** the banner/page from the sidebar until it is real | `settings/billing/page.tsx:174` |
| 12 | Seven "columns not yet in generated types" second-queries | **Finish** (`pnpm db:types`, collapse the extra fetches) | §2 |
| 13 | One-off Supabase migration scripts and the on-disk export of the old project (auth users, storage files) | **Delete** `export-all-data.ts`, `export-supplement.ts`, `import-all-data.ts`, `verify-export.ts`, `detect-missing-columns.ts`, `scripts/export/` | §5 |
| 14 | Stale worktree, stray branch, dead exports | **Delete** `.claude/worktrees/adoring-banach-13c23f`, branch `claude/adoring-banach-13c23f`, `stripe.ts:453-465`, `estimate-pdf.ts:54` param, `clients-table.tsx:32`, `scheduling/page.tsx:142` | §5, §7 |
| 15 | Zero tests on 60 `actions.ts` files (22k lines) and on `job-sync.ts` / `needs-you.ts` | **Finish** the seam tests in finish-plan slices 5-6 before the Nov 7 flip | §8 |

Also worth a decision but less visible: QuickBooks sandbox-only (production keys), Square zero live usage (dashboard checklist), `needs_you_state.snoozed_by` unread, MFA voluntary with no org-level requirement, future-dated migration filenames, `CLIENT_SMS_PAUSED` / `INVOICE_EMAILS_UNPAUSED` / `RESEND_VERIFIED_DOMAINS` / `GOOGLE_PLACES_API_KEY` / `ANTHROPIC_API_KEY` / `APP_URL` missing from the `env.ts` schema the finish-plan's definition-of-done requires.
