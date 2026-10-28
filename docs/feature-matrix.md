# Feature matrix — everything built, and whether it works (started 2026-10-28)

Goal: every row reaches **Pass** once in production, in the test org, on the device it
is used from, and stays there. No new rows until every Tier A row passes.

Tiers come from Svit's own data on 2026-10-28 (rows in her org):
bookings 837 · invoices 302 · shifts 329 · clients 99 · properties 72 · checklist
templates 30 · feed 31 · chat 28 · calendar connections 26 · client requests 16 ·
tasks 12 · time off 10 · estimates 7 · training 6 · tips 5 · offers 3 · reviews 2 ·
prepayments 2 · inventory 1 · subcontractor run 1 · contracts 0 · packages 0 · payroll
runs 0 · bonuses 0 · webhooks 0 · network 0.

- **A** — she or her cleaners use it most days. Must be 100%.
- **B** — used some weeks. Must work; verify after A.
- **C** — built, unused by her. Verify once; consider hiding per org until wanted.

Columns: Walked = date you exercised it in prod · Result = Pass / Fail (link the
feedback item) · Test = automated coverage exists · Help = article covers it.

## Field app (cleaners, on a phone)

| Tier | Surface | Walked | Result | Test | Help |
| --- | --- | --- | --- | --- | --- |
| A | /field home (today's cards, I'm here on the card) | | | | |
| A | /field/jobs list (Today / Shifts) | | | | |
| A | /field/jobs/[id] — I'm here | | | | |
| A | /field/jobs/[id] — I'm done (two taps), Not done? I'm back | | | | |
| A | /field/jobs/[id] — facts line (who's here, who hasn't arrived) | | | | |
| A | /field/jobs/[id] — checklist tick, photos | | | | |
| A | Offline tap queue (tap in airplane mode, send later) | | | | |
| A | /field/clock — one-tap job start, category punches, clock out | | | | |
| A | /field/shifts — accept / decline / call in sick | | | | |
| A | /field/hours | | | | |
| A | /field/pay (statement) | | | | |
| A | /field/time-off request | | | | |
| A | /field/availability | | | | |
| A | /field/chat (DM + threads) | | | | |
| A | /field/feed | | | | |
| B | /field/training, /field/training/[moduleId] | | | | |
| B | /field/profile, /field/profile/security (MFA) | | | | |
| A | Push notifications arrive on a cleaner's phone | | | | |
| A | SMS to a cleaner (shift assigned, reminders) | | | | |

## Manager app — daily

| Tier | Surface | Walked | Result | Test | Help |
| --- | --- | --- | --- | --- | --- |
| A | Dashboard: Needs you list and every button (Close it, Still coming, Call, Remove, Give it an hour, Clock out at, Still working, Set price, Restore, Keep) | | | | |
| A | /app/bookings list, filters, bookings-table actions | | | | |
| A | /app/bookings/new (single, recurring, splits, crew) | | | | |
| A | /app/bookings/[id] (one-line state, timeline, Mark complete) | | | | |
| A | /app/bookings/[id]/edit (this only / this and future) | | | | |
| A | /app/bookings/series | | | | |
| A | /app/bookings/requests (client skip requests) | | | | |
| A | /app/scheduling — drag to move, crew swap, dispatch grid | | | | |
| A | /app/calendar | | | | |
| A | /app/timesheets — view, edit entry, close open shift, attach stray punch | | | | |
| A | /app/clients list, /app/clients/[id], edit, properties, statement | | | | |
| A | /app/invoices list, /app/invoices/[id], edit, send, record payment | | | | |
| A | /app/invoices/period (period billing) | | | | |
| A | /app/checklists, /app/checklists/[id], /new (sections, paste) | | | | |
| A | /app/employees list, [id], edit (rates, engagement, offboarding) | | | | |
| A | /app/chat, /app/feed, /app/announce | | | | |
| A | /app/notifications | | | | |
| A | /app/tasks | | | | |
| A | /app/feedback (board) | | | | |
| A | /app/help, /app/help/[slug], AI assistant answers | | | | |

## Manager app — some weeks

| Tier | Surface | Walked | Result | Test | Help |
| --- | --- | --- | --- | --- | --- |
| B | /app/payroll, /app/payroll/[id], periods, contractors statements | | | | |
| B | /app/estimates, new, edit, send, client approval → booking | | | | |
| B | /app/leads (lifecycle, convert) | | | | |
| B | /app/reports, export | | | | |
| B | /app/reviews, review requests, GBP link | | | | |
| B | /app/training (modules, assignments) | | | | |
| B | /app/freelancers, offers, claim link flow | | | | |
| B | /app/clients/import | | | | |
| B | /app/profile, /app/profile/security | | | | |
| B | /app/setup (onboarding) | | | | |

## Manager app — built, unused by Svit

| Tier | Surface | Walked | Result | Test | Help |
| --- | --- | --- | --- | --- | --- |
| C | /app/contracts | | | | |
| C | /app/packages | | | | |
| C | /app/inventory | | | | |
| C | /app/bonuses, settings/bonus-rules | | | | |
| C | /app/hiring, /app/applicants, interviews | | | | |
| C | /app/network | | | | |
| C | /app/freelancers/payables (legacy redirect) | | | | |

## Settings

| Tier | Surface | Walked | Result | Test | Help |
| --- | --- | --- | --- | --- | --- |
| A | settings/automations (every toggle, per-client mode, thresholds) | | | | |
| A | settings/thresholds (auto-complete hours) | | | | |
| A | settings/members (invite, roles, capabilities) | | | | |
| A | settings/services | | | | |
| A | settings/invoicing, settings/tips, settings/currency, settings/timezone | | | | |
| A | settings/sms (number, opt-in) | | | | |
| A | settings/email (sender verification) | | | | |
| A | settings/integrations — Google Calendar connect, per-member calendars | | | | |
| A | settings/branding | | | | |
| B | settings/intake-forms (website estimate + contact forms) | | | | |
| B | settings/recurring-invoices | | | | |
| B | settings/payroll | | | | |
| B | settings/payment-methods, settings/billing (Stripe Connect, platform billing) | | | | |
| B | settings/data (export), settings/audit-log | | | | |
| C | settings/api-keys, settings/webhooks | | | | |
| C | Square, QuickBooks, Sage connect + sync | | | | |

## Client portal and public links

| Tier | Surface | Walked | Result | Test | Help |
| --- | --- | --- | --- | --- | --- |
| B | /client login, reset, portal home, jobs, job detail, skip request, invoices | | | | |
| A | /i/[token] invoice page + PDF, pay by card | | | | |
| B | /e/[token] estimate page + PDF, approve | | | | |
| B | /claim/[token] shift offer claim | | | | |
| B | /join/[token] invitation claim (the one join path) | | | | |
| B | /review/[token], unsubscribe links /u/* | | | | |
| B | Website intake: estimate request, contact request | | | | |
| B | Public help pages, landing pages, sitemap | | | | |

## Automations and crons (39 routes; see docs/maps/map-crons.md)

| Tier | Cron / automation | Walked (saw it fire once, correctly) | Result | Test |
| --- | --- | --- | --- | --- |
| A | shift-reminders */30: clock-out cap + nag, job watch, chase, Needs-you alerts, heartbeat | | | |
| A | complete-bookings 02:00 (nightly sweep) | | | |
| A | upcoming-jobs hourly | | | |
| A | employee-daily-schedule, employee-weekly-schedule | | | |
| A | booking-reminders-client | | | |
| A | extend-series, rederive-times | | | |
| A | member-calendar-reconcile, org-calendar-reconcile, gcal-prune | | | |
| A | invoice-auto-send, invoice-overdue, invoice-review-digest | | | |
| A | unfilled-shifts, unassigned-bookings | | | |
| B | billing-cycle, recurring-invoices, void-invoices, payroll-autodraft | | | |
| B | booking-review-requests, gbp-review-requests, rebooking-prompt | | | |
| B | stale-estimates, estimate-followup, expire-estimates | | | |
| B | task-reminders, overtime-warnings, certification-expiry | | | |
| B | weekly-ops-digest, monthly-ops-digest, product-changelog | | | |
| C | compute-bonuses, sage-reconcile, quickbooks-reconcile | | | |
| B | cleanup, archive-records, purge-orgs, trial-expiring | | | |

## Public API (API key) and webhooks

| Tier | Surface | Walked | Result | Test |
| --- | --- | --- | --- | --- |
| C | v1/bookings, v1/clients, v1/estimates, v1/invoices (GET/POST/PATCH/DELETE) | | | |
| C | Outgoing webhooks | | | |
| A | Inbound: Stripe webhook, Resend webhook, SMS inbound | | | |

## Operations

| Tier | Surface | Walked | Result |
| --- | --- | --- | --- |
| A | Sentry receives field and manager errors; Brian gets an email on a new issue | | |
| A | 8 AM morning check email | | |
| A | CI green on green; branch protection on main | | |
| A | Deploy provenance check after each push (pdx1, right SHA) | | |
