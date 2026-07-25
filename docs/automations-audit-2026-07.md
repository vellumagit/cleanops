# Automations audit — 2026-07-24

Four parallel deep audits over the entire automation surface (money paths,
booking-lifecycle comms, growth/estimates, team/office/housekeeping + cron
matrix), at commit `02502db`. Findings merged and deduplicated; each item cites
file:line as of that commit. Status column tracks remediation.

Already fixed before/during the audit (not listed below): $0 auto-invoices,
due-date-from-issue, voided-invoice dedup, reminder window gap, SMS nested
behind email, estimate_sent_email manual-send trap, bench SMS / opt-in-request
keys dead post-flip, SMS master-switch hole, CLIENT_FACING_SMS_KEYS gaps.

## CRITICAL — money paths broken outright

| # | Finding | Where | Status |
|---|---------|-------|--------|
| C1 | Recurring-invoice generation fails EVERY run: insert includes `line_items` + `notes`, neither exists on `invoices` (PGRST204). Zero invoices ever created; silent unbilled revenue. `as never` casts hide it from tsc. | automations.ts:5570-5586 | FIXED (Tranche 1) |
| C2 | Flat-rate consolidated billing fails the same way (`notes` on insert). Flat-rate biweekly/monthly clients are never invoiced; counted as "skipped". | api/cron/billing-cycle/route.ts:239 | FIXED (Tranche 1) |
| C3 | Nothing ever flips `sent` → `overdue` (only the payment-ledger trigger does, which needs a payment event). Overdue reminders + auto-void are dead for the normal never-paid case. | automations.ts:1772, migration 20260714010000:111 | FIXED (Tranche 1) |

## HIGH — silent client/crew harm

| # | Finding | Where | Status |
|---|---------|-------|--------|
| B1 | Drag-drop scheduler reschedule notifies NO ONE (no client notice, no crew push). Highest-traffic reschedule path. | scheduling/actions.ts:58-276 | FIXED (Tranche 2) |
| B2 | Quick status-dropdown cancel sends no cancellation notices (edit-form path is wired; dropdown isn't, despite docstring claiming parity). | bookings/actions.ts:2086-2110 | FIXED (Tranche 2) |
| B3 | Series cancel: zero notices for any occurrence (no crew pushes, no client notice). | bookings/actions.ts:2379-2461 | FIXED (Tranche 2) |
| B4 | Estimate-approval auto-booking: UNGATED (violates opt-in policy), inserts `confirmed` at tomorrow 09:00 UTC = 3 AM Edmonton, which the reminder cron then announces to the client as a real visit. Flagged independently by two audits. | automations.ts:683-744 | FIXED (Tranche 2) |
| B5 | Reschedule never clears `client_reminder_sent_at` → a moved booking is never re-reminded for its new date. | bookings/actions.ts:1068-1086, scheduling/actions.ts:195 | FIXED (Tranche 2) |
| M1 | Double-billing cluster: (a) billing-cycle line items don't set `booking_id`; (b) force-generate paths never check `bookings.billing_invoice_id`; (c) billing-cycle crash between invoice insert and booking stamp double-bills next period (23505 branch doesn't stamp); (d) manual invoice creation never stamps `billing_invoice_id`. | billing-cycle:294-301,247-254; automations.ts:294-343; invoices/actions.ts:77-96,846-913 | FIXED (Tranche 1) |
| G1 | Internal review requests flood recurring clients on enable: per-booking dedup only, no per-client cap — 4 completed bookings in 30d window = 4 emails in one run. | automations.ts:1963-1984 | FIXED (Tranche 5) |
| T1 | Employee daily-schedule cron (06:00 UTC) = 23:00 previous day in MST — employees get "today's" schedule for the day that just ended, all winter. | vercel.json:86, automations.ts:4552 | FIXED (Tranche 3) |
| T2 | notifyUpcomingJobs is dead: 1-hour lookahead on a once-daily cron — only jobs at ~1 AM Edmonton can match. Also ungated. | automations.ts:517 | FIXED (Tranche 3) |
| T3 | Task reminders documented "every 5 min", scheduled once daily 08:00 UTC (2 AM Edmonton) — up to 24h late. Ungated (bypasses master switch). | vercel.json:146 | FIXED (Tranche 3) |
| T4 | Review bonuses re-award every week (real money): rolling period dates never match the exact-date dedup, so a qualifying employee is paid again each Monday. | automations.ts:3624-3656 | FIXED (Tranche 1) |
| T5 | "Blank = disable" thresholds don't disable — all four hygiene crons `?? default`, so blanking the field still expires/voids/completes/archives at defaults. | automations.ts:5285,5327,5372,5438; thresholds/form.tsx:111 | FIXED (Tranche 3) |
| G2 | Cross-org authz: sendEstimateAction never scopes the estimate to the caller's org — any authenticated member of any org can force-send another org's estimate by UUID. | estimates/actions.ts:231-247, automations.ts:2938-2946 | FIXED (Tranche 3) |

## MEDIUM

| # | Finding | Where | Status |
|---|---------|-------|--------|
| P1 | Invoice auto-send + consolidated billing-cycle generation sit entirely OUTSIDE the automations master switch (own org columns + separate settings page). "Master off = nothing fires" is false for them. POLICY DECISION needed: gate them or document as billing settings. | invoice-send.ts:222-374, billing-cycle (no gate) | FIXED (Tranche 4) |
| P2 | Stripe/Square-paid invoices never trigger autoOnInvoicePaid — receipts/review asks only fire for manually recorded payments. Flagged by two audits. | integrations/stripe/webhook:187-235, invoices/actions.ts:328 | FIXED (Tranche 4) |
| P3 | autoVoidOldInvoices sets status without `voided_at` — any later ledger event resurrects the "void"; payments can still be recorded against it. | automations.ts:5334-5341 | FIXED (Tranche 1) |
| P4 | Voiding a consolidated invoice never un-stamps bookings and the period-key unique index isn't partial on voided — the period can never be re-billed. | invoices/actions.ts:714-749, money_hardening:147 | FIXED (Tranche 1) |
| P5 | Monthly consolidated invoice line reads the WRONG month ("Services — July" for June work). | billing-cycle:90-92 | FIXED (Tranche 4) |
| P6 | Recurring/monthly `setUTCMonth` month-end drift: series anchored day 29-31 slips (Jan 31 → Mar 3), skipping a billing month. Flagged by two audits. | automations.ts:5538-5543 | FIXED (Tranche 4) |
| P7 | autoOnInvoicePaid re-fires receipt+review on any later payment row once total ≥ amount (no receipt_sent_at stamp). | invoices/actions.ts:325-329 | FIXED (Tranche 4) |
| P8 | Re-enabling auto-send leaves previously "held" invoices held forever. | settings/invoicing/actions.ts:43-51 | FIXED (Tranche 4) |
| P9 | Recurring-series invoices were never scheduled for auto-send (fixed alongside C1). | automations.ts | FIXED (Tranche 1) |
| B6 | Series "this and future" schedule change: future occurrences deleted+regenerated silently; at most one occurrence's change is announced. | bookings/actions.ts:1264-1417 | FIXED (Tranche 5) |
| B7 | CLIENT_SMS_PAUSED blocks EMPLOYEE assignment texts, contradicting its documented client-only contract. | sms.ts:87-89 vs 212-218 | FIXED (Tranche 4) |
| B8 | Recurring-booking creation + convert-to-recurring notify no one (no assignment push for the cleaner). | bookings/actions.ts:702-940,1659 | FIXED (Tranche 4) |
| B9 | resolveClientNotify swallows DB errors as "no reachable channel", unlogged; org-default fetch fails OPEN to email while client fetch fails CLOSED — inconsistent. | notification-gate.ts:60-91 | FIXED (Tranche 4) |
| G3 | Stale-estimate followups have no CAS claim — decided_at race can email "still thinking it over?" right after approval; overlapping runs can double-send. | automations.ts:1658-1739 | FIXED (Tranche 4) |
| G4 | Day-14 followup copy says "expires in the next few days"; actual expiry is day 30. | email-templates.ts:1732-1761 | FIXED (Tranche 4) |
| G5 | Estimate resend bumps sent_at but never extends expires_at — public page can say "expired" while followups still link to it. | automations.ts:3054-3063 vs 2967-2977 | FIXED (Tranche 4) |
| G6 | Rebooking prompts: no recency ceiling (will email clients last served 2 years ago, monthly, forever) + unbounded cross-org scan doing per-client work before the org gate + CTA is a mailto to noreply@ + no unsubscribe (CASL). | automations.ts:1450-1564, email-templates.ts:1677-1714 | FIXED (Tranche 4) |
| T6 | Dead code: autoAssignTraining (never called) and postSystemFeedEvent (never called — the system_feed_events toggle is wired to nothing). | automations.ts:620,849 | FIXED (Tranche 4) |
| T7 | alertStaleEstimates ungated (no key, no master switch). | automations.ts:750-838 | FIXED (Tranche 3) |
| T8 | unfilled-shifts cron: ungated, formats times in UTC (admins see wrong hours), overlaps the gated unassigned_booking_alert. | api/cron/unfilled-shifts:85-90 | FIXED (Tranche 3) |
| T9 | Deactivated members still receive schedules/overtime/payroll/PTO/cert emails (getMembershipRecipient never filters status). | automations.ts:89-128 | FIXED (Tranche 3) |

## LOW (tracked, fix opportunistically)

Fixed in Tranche 5: reminder-cron N+1 + per-booking crash isolation,
duplicate-booking pending+reminder-stamp, estimate first-send token race,
review-candidate ordering, crew fan-out on reschedule/cancel pushes, stale doc
comments. Remaining lows below are accepted as-is for now (tiny races /
cosmetic boundaries).

- Reminder cron: contact_phone N+1 (org cache has it), no per-booking try/catch (one throw aborts the batch tail), template work done before gating. (automations.ts:2855-2887)
- "Confirmation" email fires for `pending` bookings at creation; never on pending→confirmed. Semantics decision. (bookings/actions.ts:608)
- Delete / skip-occurrence notify no one (skip is semantically a cancellation). Product decision. (actions.ts:2117,2285)
- Reschedule/cancel pushes reach only the primary assignee, not booking_assignees crew. (automations.ts:1103,1237)
- duplicateBookingAction inserts `confirmed` at the source's date — reminder cron can announce a duplicate visit if abandoned. (actions.ts:1839,1883)
- Review-request candidates `limit(200)` with no order — nondeterministic under backlog. (automations.ts:1984)
- Estimate first-send token race (two admins) → one dead /e/ link. (automations.ts:2965-2977)
- runInvoiceAutoSend fresh-check isn't an atomic claim — tiny duplicate-send race with manual send. (invoice-send.ts:412-421)
- Manual void vs in-flight Stripe checkout: client charged, no ledger row (warn only). (webhook/route.ts:64)
- Billing-cycle UTC boundary: evening jobs on the 14th/last day roll to next period (delayed, not lost); labels render in UTC. Weekly digest boundary double-count. Overtime week is UTC not org-local. Weekly-schedule label off by a day.
- Overtime warning logs cumulative counter per-org (log noise only).
- Stale doc comments: setBookingStatusAction "same side-effects" claim; hygiene "NULL disables" banner; automations.ts:1212 "future feature"; 1311 "mutually exclusive channels"; task-reminders "every 5 minutes"; booking-review-requests "20+ hours".

## Verified sound (high-confidence areas)

- Cron registration matrix: 34 vercel.json entries ↔ 33 routes, all present both
  directions, all CRON_SECRET-authed. billing-cycle dual schedule intentional.
- All 31 isAutomationEnabled key strings match the settings UI union.
- isAutomationEnabled: master-first, explicit-opt-in, fails closed.
- sendOrgSms gate ordering (post-02502db) incl. master switch + manual keys.
- Per-client preference wiring: all four booking senders + all four growth
  senders + overdue/auto-send/receipt correctly categorized and gated.
- Review-request + GBP CAS claims (rowcount-guarded), GBP state machine,
  unsubscribe endpoints (RFC 8058), reminder caps.
- Stripe webhook payment dedup, refund idempotency, cross-tenant guards.
- Billing-cycle period idempotency (billing_period_key + unique index).
- Ops digests, PTO/payroll/training/cert notifications, hygiene gating
  (except T5), purge/trial/cleanup platform crons.
- Reminder window (6-32h) tiles the daily cron with dedup absorbing overlap.
