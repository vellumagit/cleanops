# Half-shipped inventory — every row has a verdict (2026-11-10)

Slice 10 of `finish-plan-2026-10-28.md`. The inventory was written on
2026-10-28 (the plan's list, plus the longer `docs/maps/map-half-shipped.md`).
Each row was re-checked against the code and against production (read-only,
counts only) on 2026-11-10. Nothing here is from memory.

## Closed

| Row | How |
| --- | --- |
| Cleaner clock-ins never carry the phone's tap time | The app's clock-in actions bound the tap time and write through the service role, which the insert guard lets through. A row a cleaner inserts directly still takes the server's clock, on purpose. Pinned in `test/db/rls.test.ts` |
| Morning check never scheduled | `/api/cron/morning-check` emails at 8 AM. `scripts/shadow-morning-check.ts` is the script it replaced |
| Help describes buttons that no longer exist | Most was rewritten in October. Today: the last "Start job" became "I'm here", and the sentence promising flat and percentage pay types is gone |
| CI "validate cron schedules" red on every push | Green. CI now also runs lint and the database tests |
| No tests on any server action | 61 scenarios run the real actions against a real database (`test/db/*.api.test.ts`) |
| Stale worktree and branch | Not on this machine |
| `verifyStripeSignaturePlaceholder` | Deleted today; nothing called it |

## Fixed today

| Row | What changed |
| --- | --- |
| Security Batch B: webhook secrets readable by every member | Migration `20261110040000`. Only owners and admins read webhooks. No webhook exists in production, so nothing was exposed |
| Security Batch B: integration events with no company readable by any signed-in user of any company | Same migration. No such row exists in production |
| A broken integration just disappears | Settings → Integrations now says which connection stopped syncing, when, and why. Production has five company-level connections in an error state (QuickBooks and Sage on the test company, one Google Calendar) |
| Reads truncate silently at 1000 rows; long id lists fail at about 390 | The query guard logs both (`[db-truncated]`, `[db-long-in]`). Logging only for now. Svit has 879 bookings, 1552 audit rows and 1347 notifications, so this will start speaking soon |
| Webhooks offers events that can never fire | "Invoice sent" and "Client submitted review" removed; the page now says webhooks fire for API and website-form changes, not for changes made in the app |
| Billing page shows a developer's note to owners | Reworded: billing is not switched on and nothing will charge |
| Flags missing from `src/lib/env.ts` | `JOB_STATE_WRITE`, `INVOICE_EMAILS_UNPAUSED`, `CLIENT_SMS_PAUSED`, `RESEND_VERIFIED_DOMAINS`, `ANTHROPIC_API_KEY`, `GOOGLE_PLACES_API_KEY` added |

Also fixed the same day, after this list was first written: **job review
links.** A cleaner could read the link for her own job from the bookings table
and leave her own five-star review, and review bonuses pay money. Review links
are now signed by the server and not stored (`src/lib/review-token.ts`); links
already emailed keep working through a hash, and migration `20261110050000`
replaces the stored tokens with those hashes. **Run that one after the push.**
`test/db/reviews.api.test.ts` has a cleaner read what she can read and fail to
use it.

Earlier the same day, from the same audit: seven internal database functions
closed to the public key (`20261110010000`), and shift history no longer
deleted with a member (`20261110030000`).

## Dated

| Row | When |
| --- | --- |
| Job-state rules in shadow, two systems writing status | Saturday 2026-11-14, `docs/cutover-2026-11-14.md` |
| Feedback board has two items since September | Saturday, with Svitlana |

## Yours to do (nothing to build)

| Row | What it needs |
| --- | --- |
| **The Friday changelog has not gone out since 2026-10-09** | The entries were written by a scheduled task on the old computer. It does not exist on this one. Say the word and it is recreated here; it writes to production and the result is emailed to owners, so it is not something to switch on unasked |
| Sentry unreadable from a session | A Sentry token or connector. Until then, errors arrive by you pasting them |
| QuickBooks production keys | Your step in the Intuit dashboard. Sandbox-verified 2026-09-05 |
| Square dashboard checklist | Your step. One disconnected connection, no live use |

## Decide: build it or drop it

Recommendation first in each.

| Row | Facts | Recommendation |
| --- | --- | --- |
| Invoice, estimate and contract links readable by managers | **Closed for cleaners** by migration `20261110060000`: only owners, admins and managers read those tables now, which is all the app ever needed. Managers can still read the links; they can already send and act on these documents | **Leave.** Signing these links like the review link means touching 21 files on the payment path for a manager-only risk |
| Inbound SMS: a client's real reply is acknowledged and thrown away | STOP/START/HELP work. Anything else is stored nowhere and shown to nobody | **Built 2026-11-11:** saved to `sms_messages` (inbound), sender named, owners/admins/managers told in the app and by email (once per sender per 30 min). No auto-reply. `src/lib/sms-inbound-reply.ts`, `test/db/sms-replies.api.test.ts`. Same day: keywords no longer read from the first word alone ("Cancel my Friday clean" still unsubscribes and now reaches the office; "Yes I can take Saturday" is a reply, not consent) |
| Part-paid invoices past due are never chased (money list #8) | No such invoice today; the reminder is off for Svit | **Build** the remind-on-balance version when reminders are switched on |
| Property-level default checklist | The field saves and nothing applies it. No property has one set | **Dropped 2026-11-11:** field and helper removed (0 of 83 properties had one). Migration `20261111010000` drops the column; run it after the push |
| `pay_type` (flat, percent) | Column and constraint exist; nothing writes it; everyone is hourly | **Dropped 2026-11-11:** removed from Timesheets (and its CSV's "Pay Type" column), types and seed. Migration `20261111020000` rewrites the owner guard without it, then drops the column (all 59 memberships were hourly) |
| Assistant conversations saved and never read | 18 rows. The flag button already emails support | **Dropped 2026-11-11:** no longer saved, and the assistant no longer tells users the chat is saved. The table and its 18 rows remain until someone decides to delete them |
| Webhooks for changes made in the app | Nobody has configured a webhook | **Leave** as API-only. After the cutover, status changes have one place to fire from if it is ever wanted |
| Simulated SMS numbers never upgraded | No company has one | **Leave** |
| Seven "columns not in the generated types" second queries | Correctness is now checked by `test/db/query-shapes.test.ts` | **Leave**; regenerate types when convenient |
| One-off scripts from the Supabase project move, and the replaced morning-check script | `export-all-data.ts`, `export-supplement.ts`, `import-all-data.ts`, `verify-export.ts`, `detect-missing-columns.ts`, `shadow-morning-check.ts`. The on-disk export with auth users is not on this machine | **Deleted 2026-11-11**, all but `shadow-morning-check.ts`: the 8 AM email names it as the by-hand fallback when the cron fails, so it stays |

## From the security audit, closed 2026-11-11

- **API keys of a suspended company** now get 403 (`src/lib/api-key-auth.ts`).
- **Estimate PDFs** go to the private `estimate-pdfs` bucket (migration
  `20261111040000`, run before the push); viewers get links that expire in an
  hour (`src/lib/estimate-pdf-storage.ts`). No estimate had a PDF attached; one
  orphaned file is still in the public `org-assets` bucket until deleted.
- **The public API** answers failures with a sentence and a reference, never
  the database's text (`src/lib/api/errors.ts`); a cleaner already booked gets
  409 in words.
- **Login and signup** show written messages, not the auth server's
  (`src/lib/auth-errors.ts`). A signup with an email that already has an
  account is answered exactly like a new one waiting on confirmation, and the
  stand-in user Supabase can return for it is never given a company or deleted.

## Still open from August, each a business rule

Not re-verified today: the Timesheets CSV mixes employees and subcontractors
with no column to tell them apart; a bonus given to a subcontractor has no pay
run that will ever pay it.
