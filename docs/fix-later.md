# Fix-later pile

Started 16 Nov 2026, during the push to finish testing. The rule while
testing: a test that finds a fault does not fix it. The fault goes here, and
the test that shows it is marked `it.fails(...)` with a `FIX-LATER` comment.
The suite stays green, and when someone fixes the fault, that test starts
failing, which is the reminder to turn it back into a normal `it(...)`.

Severity: **High** = money, privacy or another company's data at risk;
**Med** = wrong result someone will notice; **Low** = wording, edge cases.
Faults marked **Security** should go first.

## Waiting on you

- **Managers migration.** `supabase/migrations/20261116060000_managers_update_estimates_invoices.sql`
  gives managers (Olha) back the right to change estimates and invoices. The
  code shipped in 99b679b works either way; until it runs, a manager's save
  says "wasn't saved" instead of saving.
- **Elena and Promotional billing day** (from my notes, Nov 10): reset both
  clients' billing day to blank after the Nov 15 monthly run. It may already
  be done.

- **The live database has drifted from the migrations.** Migration
  `20260421020000_webhooks_unification.sql` never ran in production:
  `webhook_subscriptions` still exists and `webhook_deliveries` has its old
  columns (`subscription_id`, no `webhook_id`). No company has a webhook set
  up, so nothing breaks today, but webhook delivery would fail, and other
  migrations may be missing too. Worth a full schema comparison (Supabase's
  schema diff) before trusting the tests to stand for production.

## Decisions for you

1. **Should renaming a service update upcoming visits?** 8 visits still show
   "Deep clean" after a rename. (Nov 15 batches.)
2. **Series extension when the cleaner is busy:** today the visit is skipped.
   Create it without that cleaner instead? (Nov 15 batches.)

## Faults

### Website forms, leads, estimates

| # | Sev | What's wrong | Where | Shown by |
|---|---|---|---|---|
| 1 | Med | A new person who shares a name with an existing client but has a different email is filed under that client: their email and phone are saved nowhere, and "Send estimate" would email the quote to the other person. The email match also uses `ilike`, so `_` in an address is a wildcard (`m_underwood@` lands on `m.underwood@`). Fix: match by name only when one side has no email; compare emails exactly. | `src/lib/find-or-create-client.ts` | `settings-api-v1` "a visitor whose email only looks like an existing client's gets a lead of their own" |
| 2 | Low | Booking create, edit and skip start the Google Calendar sync without waiting; the redirect can end the function first. The nightly reconcile repairs misses. Fix: wrap in `after()`. | `src/app/app/bookings/actions.ts` (`syncMemberCalendarEvents(...).catch`) | — |
| 3 | Low | An estimate the expiry job marks expired still shows "Valid until …" on the client's page (reads `expires_at`, not status). Svit has auto-expire off. | `src/app/e/[token]/page.tsx` | — |
| 4 | Low | Saving an archived estimate shows the raw database message instead of plain words. | `src/app/app/estimates/actions.ts` | — |

### Recurring invoices (Settings → Recurring invoices, nightly job)

| # | Sev | What's wrong | Where | Shown by |
|---|---|---|---|---|
| 5 | High | A recurring invoice can be set up for another company's client: the action doesn't check the client, and `invoice_series` lacks the client-company guard `invoices` has. | `settings/recurring-invoices/actions.ts` create + update | `settings-recurring-invoices` "never makes a series for another company's client" |
| 6 | High | One recurring invoice that fails to save stops the whole nightly run: its period is skipped silently, and every company later in the run gets no invoice that night. Fix: catch per series and give the period back. | `src/lib/automations/billing.ts` ~715–745 | "…gives its period back and doesn't stop other companies' invoices" |
| 7 | Med | The form's line-item example uses `description`/`unit_cents`; the job reads `label`/`unit_price_cents`. Lines written like the example bill at $0 under a correct total. | `recurring-invoices/form.tsx` placeholder vs `billing.ts` ~768–790 | "…bills lines that add up to the invoice" |
| 8 | Med | Recurring-invoice buttons ignore a manager's Invoices switch. | `recurring-invoices/actions.ts`, `page.tsx` | "a manager with Invoices & estimates switched off can't make a standing invoice" |
| 9 | Med | The first-run date is saved as UTC midnight, a day early in Alberta: the list shows Nov 30 for Dec 1. | `recurring-invoices/actions.ts` ~89, ~163 | "the first invoice date … is that date in the company's own calendar" |
| 10 | Low | Month-end series drift to the 28th after February, though the code says it prevents that. | `billing.ts` ~622–652 | "…stays on the last day after a short month" |
| 11 | Low | Due date counts from UTC's day, not the company's (hidden for Alberta by the run time). | `billing.ts` ~613–616 | "counts the due date from the company's day…" |
| 12 | Low | A save that matched no series reports success. | `recurring-invoices/actions.ts` ~155–184 | "a save that matched no series says so…" |

### Public API (API keys)

| # | Sev | What's wrong | Where | Shown by |
|---|---|---|---|---|
| 13 | Med | The `invoice.paid` webhook re-fires on every later edit of a paid invoice (double bookkeeping in connected tools). | `api/v1/invoices/[id]/route.ts` ~100–126 | `settings-api-v1` "invoice.paid goes out once…" |
| 14 | Med | A bad PDF answers 400, but the estimate (and a new lead) is already saved, so retries duplicate. | `api/v1/estimates/route.ts` ~165–208 | "a PDF that isn't one is refused before the estimate is made…" |
| 15 | Low | Editing another company's or a missing invoice/estimate answers 500, not 404; a malformed id crashes the route. Nothing is changed. | `api/v1/*/[id]/route.ts` | "…answers 404, not a server error"; "a malformed id answers 404…" |

### Other settings

| # | Sev | What's wrong | Where | Shown by |
|---|---|---|---|---|
| 16 | Med | Company deletion compares the typed name with a name the page sent, then schedules whichever company is active: an owner of two companies with a stale tab can schedule the wrong one (30-day grace applies). | `settings/data/actions.ts` ~20–32 | `settings-actions` "the name typed must be the name of the company being deleted" |
| 17 | Med | A sender-email save refused by the daily limit still replaces and unverifies the sender, killing the link already emailed. | `settings/email/actions.ts` ~83–109 | "a save refused by the daily limit leaves the verified sender as it was" |
| 18 | Low | The sender verification link never expires, though its email says 24 hours. | `api/verify-sender/route.ts` | "the link stops working after the 24 hours its email promises" |
| 19 | Low | Archiving or unarchiving a service that isn't ours still writes an audit entry. | `settings/services/actions.ts` ~185–233 | "archiving a service that isn't ours leaves no 'archived' entry…" |

### Integrations (Google Calendar, QuickBooks, Sage)

| # | Sev | What's wrong | Where | Shown by |
|---|---|---|---|---|
| 20 | High, Security | Google Calendar connect uses the person's membership id as its OAuth state, not a one-time secret. Anyone who knows an owner's id (a teammate, an ex-employee) can connect that company's calendar to their own Google account and receive every job (client names, addresses, notes); the same works against a cleaner's personal calendar. Fix: `issueOAuthState`/`consumeOAuthState`, as QuickBooks and Sage do. | `settings/integrations/google-calendar-actions.ts` ~30, `field/profile/actions.ts` ~124, `api/integrations/google-calendar/callback/route.ts` | `integrations-oauth` (3 tests: forged state cookie, callback never started, teammate takeover) |
| 21 | High, Security | "Sync to QuickBooks/Sage" doesn't check the invoice belongs to the caller's company: any office person can book another company's invoice (even a draft) into that company's books, and the error leaks its client name. | `invoices/actions.ts` ~1139, ~1175; `lib/quickbooks.ts` ~574, `lib/sage.ts` ~806 | `integrations-sync` "another company's invoice id books nothing into their QuickBooks / Sage" |
| 22 | Med | The company's Google Disconnect also switches off every cleaner's own calendar connection. Fix: `.is("membership_id", null)`. | `google-calendar-actions.ts` ~57–62 | `integrations-oauth` "the company's Disconnect leaves each cleaner's own calendar connected" |
| 23 | Med | After switching Google accounts, a 30-second token cache pushes the jobs back onto the old calendar; the new one stays empty. | `lib/google-calendar.ts` ~274–290 | "reconnecting with a different Google account moves the company's jobs…" (+ cleaner version) |
| 24 | Med | A voided invoice can be booked into QuickBooks/Sage as revenue (from a stale page). | `lib/quickbooks.ts` ~611, `lib/sage.ts` ~847 | "a voided invoice is not booked into QuickBooks / Sage" |
| 25 | Low | Sync buttons ignore a manager's Invoices switch (other invoice actions don't check it either). | `invoices/actions.ts` ~1139, ~1175 | "a manager with invoicing switched off can't push an invoice into the books" |
| 26 | Med | Admin repair tool gcal-force-resync finds no company calendar once any cleaner has connected their own; with only cleaners connected, it wipes a cleaner's calendar. | `api/admin/gcal-force-resync/route.ts` ~44–60 | `integrations-gcal-admin` (2 tests) |
| 27 | Med | gcal-force-resync deletes another company's live events on a shared calendar. | same, ~139–167 | "…the other company's live events stay" |
| 28 | Low | gcal-force-resync never finishes past 40 events. | same, ~150 | "with more than 40 jobs, running it again…" |

Live exposure (production, read-only, 16 Nov): the only connected
integration anywhere is Svit's Google Calendar, company plus 8 cleaners'
own. So #20, #22 and #23 touch Svit today; #21 and #24–#25 (QuickBooks/Sage)
touch no one yet.

### Clients, checklists, contracts, client emails

| # | Sev | What's wrong | Where | Shown by |
|---|---|---|---|---|
| 29 | High, Legal | The unsubscribe link in rebooking emails does nothing: `if (rl)` is always true, so POST returns before unsubscribing and GET always answers 429. This is the CASL / one-click unsubscribe link. Live: one Svit client was ever nudged (April). Fix: `if (!rl.allowed)`. | `api/u/m/[token]/route.ts` ~64, ~75 | `clients-review-crons` "the unsubscribe link in the email stops the next one" |
| 30 | High | Client import skips the daily new-client cap and the disposable-email check (the abuse route from 11 Sep). A new workspace imported 250 where the cap is 200. | `clients/import/actions.ts` ~238 | `clients-records` "a workspace in its first week can't import past its 200-new-clients-a-day limit" |
| 31 | High | Assigning a checklist with another company's client id reports ok, and the service-role backfill copies this company's items onto that company's upcoming jobs. | `checklists/actions.ts` ~410–424 | `clients-checklists-contracts` "a client id from another company can't be given this company's checklist" |
| 32 | High | Editing another company's checklist template id inserts items into it, and their next job copies them. | `checklists/actions.ts` ~214–251 | "editing another company's template id changes nothing there and says so" |
| 33 | Med | Booking review requests stall: the job reads the 200 oldest unasked jobs across all companies, and skipped ones (switched off, house default "none") are never stamped, so they hold the window. Svit's default "none" fills it. | `lib/automations.ts` ~1968–1986 | `clients-review-crons` "…reach a company switched on even when 200 older jobs elsewhere will never be asked" |
| 34 | Med | The rebooking prompt only ever looks at the first 500 clients (no order, never advances). | `lib/automations.ts` ~1243 | "the rebooking prompt reaches a client past the first 500…" |
| 35 | Med | Re-importing a list creates duplicates past 1,000 existing clients (the API's row cap). | `clients/import/actions.ts` ~211 | `clients-records` "re-importing a 1,200-client list adds nobody…" |
| 36 | Med | A retried photo "finish" deletes the file the first save recorded, leaving a broken photo. | `lib/client-media-actions.ts` ~159 | "finishing the same upload twice (a retry) keeps the file…" |
| 37 | Med | A checklist template can be put on another company's job. | `checklists/actions.ts` ~325–372 | "a template can't be put on another company's job" |
| 38 | Med | Deleting a contract leaves its document files in storage. | `contracts/actions.ts` ~129 | "deleting a contract takes its documents' files with it" |
| 39 | Med | Contract documents can be attached to another company's contract. | `contracts/document-actions.ts` ~26–62 | "a document can't be attached to another company's contract" |
| 40 | Low | Two signs submitted at once both sign: the second overwrites the first's evidence and the office is told twice. | `c/[token]/sign-actions.ts` ~131 | "two submits at the same moment sign it once" |
| 41 | Low | A contract save that changed nothing looks saved. | `contracts/actions.ts` ~106 | "a contract save that changed nothing says so…" |
| 42 | Low | A contract document whose record fails to save leaves its file behind. | `contracts/document-actions.ts` ~52 | "a document whose record can't be saved leaves no file behind" |
| 43 | Low | Taking a checklist off a client that isn't ours reports success. | `checklists/actions.ts` ~447 | "taking a checklist off a client that isn't this company's says nothing changed" |
| 44 | Low | Removing another company's checklist item reports ok. | `checklists/actions.ts` ~520 | "removing another company's checklist item says it wasn't removed" |
| 45 | Low | A person listed twice in one CSV becomes two clients. | `clients/import/actions.ts` ~222 | "a person listed twice in the same file becomes one client" |

### Payments, refunds, texting, email bounces

| # | Sev | What's wrong | Where | Shown by |
|---|---|---|---|---|
| 46 | High (nobody on Square yet) | Square disconnects itself when its 30-day token runs out: the refresh saves `connected_by: ""`, the insert fails, and the old row was already retired. Clients' Pay button fails; refunds crash. | `lib/square.ts` ~447, ~352–369 | `payments-public` + `payments-refunds` (token run out) |
| 47 | Med (nobody on Square yet) | Square refunds are always requested in CAD; a USD company's refunds fail. | `lib/square-refunds.ts` ~135 | `payments-refunds` "a US-dollar company's refund is asked for in US dollars…" |
| 48 | Med | A bounce or complaint naming several addresses only blocks the first, though the reply says all; the app keeps emailing the rest. | `api/webhooks/resend/route.ts` ~166, `lib/email-suppression.ts` ~86 | `payments-public` "a bounce that names two addresses puts both on the list…" |
| 49 | Low | The refund audit entry uses the invoice id posted with the form, not the payment's own invoice. | `invoices/actions.ts` ~689, ~741 | `payments-refunds` "the audit entry names the payment's own invoice…" |
| 50 | Low | A cleared SMS cap field saves as $0 ("Cap saved."), silently stopping every text past the included allotment. | `settings/sms/actions.ts` ~166 | `payments-sms` "a cleared cap field is refused, not saved as $0…" |

### Office tools, tasks, team chat, reviews, on-call pool

| # | Sev | What's wrong | Where | Shown by |
|---|---|---|---|---|
| 51 | Med, Privacy | Deactivated cleaners still get team chat pushes (#general and announcements, with the message preview): pushes go to every thread member whatever their status, and deactivation never removes them. Svit has deactivated cleaners (Olga, for one). | `lib/chat-actions.ts` ~217–262 | `ops-team-jobs` "doesn't buzz the phone of a cleaner who has been deactivated" |
| 52 | Med | Saving a task moves its due and reminder times 6 hours earlier: the form's time is stored as UTC, so 9:00 AM becomes 3 AM Alberta, and every save shifts it again. | `tasks/actions.ts` ~139, `lib/validators/tasks.ts` | `ops-team-jobs` "opening a task and saving it unchanged keeps its due time and reminder" |
| 53 | Med | A cleaner can take over any task by assigning it to themselves: the task update policy admits any member, and the action has no role check. | `tasks/actions.ts` ~122–145, migration `20260514010000_tasks.sql` ~92 | "a cleaner can't take over a task that isn't hers" |
| 54 | Med | One person's "mark all read" clears the team announcement for everyone (an org-wide notice is one row), though the code promises it doesn't. | `notifications/actions.ts` ~26–36, `lib/notify.ts` ~236 | "the owner marking everything read leaves the team announcement unread for the manager" |
| 55 | Med | An on-call contact's phone typed without +1 ("780 271 1971") is saved as `+7802711971`, a Russian number, so shift-offer texts go astray. `lib/phone.ts` fixed this elsewhere. | `lib/validators/freelancer.ts` ~13–20 | `ops-office-lists` "a local ten-digit number is saved as the North American number it is" |
| 56 | Low | Editing a task whose reminder already went sends it again. | `tasks/actions.ts` ~142 | "editing a task whose reminder already went doesn't send it again" |
| 57 | Low | Managers with the on-call pool switched off can still add, change and remove contacts, and cancel offers. | `freelancers/actions.ts` | "a manager without the on-call pool can't…" (2 tests) |
| 58 | Low | Deleting an on-call contact logs a deletion that didn't happen (e.g. a cleaner's press). | `freelancers/actions.ts` ~153 | "a delete that removed nothing leaves no 'deleted' in the history" |
| 59 | Low | A manager pinning someone else's post is told "Pinned", but nothing changes (the database allows only the author or owner/admin). | `lib/feed-actions.ts` ~163 | "a manager pinning someone else's post either pins it or is told she can't" |
| 60 | Low | The owner's new-review notice never names the cleaner (looks up a profile by a membership id). | `reviews/actions.ts` ~50 | "the owner's notice names the cleaner the review is for" |
| 61 | Low | Saves that matched nothing still report success: review corrections, packages, inventory, network contacts (plus a false "update" audit entry), on-call contacts. | `reviews` ~115, `packages` ~63, `inventory` ~56, `network` ~76, `freelancers` ~108 | `ops-office-lists` "a save that changed no … says so" (5 tests) |

### Invoice emails, trials, company purge, assistant

| # | Sev | What's wrong | Where | Shown by |
|---|---|---|---|---|
| 62 | High | Purging a deleted company leaves its personal data in about 17 tables the purge doesn't list (job applicants with résumés, text messages, prepayments, AI conversations, API keys, intake forms…): the company row is kept as a tombstone, so database cascades never fire. Right-to-erasure. Fix: add them, plus a test comparing the list with the real tables. | `lib/tenant-data.ts` ~517–591 | `crons-admin-purge` "leaves none of the org's personal data behind…" |
| 63 | High (not live: see drift) | The purge list still names `webhook_subscriptions`, which the migrations dropped, so against the migrated schema every purge stops before the tombstone and before erasing members' logins, and `admin/purge-org` always answers not-ok. Production still has the table (drift), and no company is due for purge. | `lib/tenant-data.ts` ~582 | "a purge against the schema the migrations build finishes without errors…" |
| 64 | Med | The purge's batched-delete fallback (for a big company that times out) can't run inside the cron: the fail-closed guard throws first, so a large company can never be purged. | `lib/tenant-data.ts` ~338–346 | "falls back to batched deletes when the one-statement delete times out…" |
| 65 | Low | A purge that failed is still reported as purged, hiding it from the morning check. | `lib/tenant-data.ts` ~842–853 | "an org whose purge failed is not reported as purged" |
| 66 | Med | A scheduled invoice that took a part prepayment is never auto-sent: the payment makes it part-paid, and auto-send only looks at drafts. The client never gets the bill for the balance (Svit's prepay flow). | `lib/invoice-send.ts` ~511, ~618 | `crons-invoice-email` "a scheduled draft that took a part prepayment is still sent to the client" |
| 67 | Med | Auto-send skips a client with no email and never tells the owner, though the code promises an alert; the morning digest had listed it as going out. | `lib/invoice-send.ts` ~590–599 | "a client with no email: the draft is skipped and the owner is told…" |
| 68 | Low | Two overdue-reminder runs at once both remind the same client (sends, then stamps). | `lib/automations.ts` ~1823–1884 | "two runs at the same moment remind each client once" |
| 69 | Med | The in-app assistant refuses anyone active in two companies (you, for one: Svit plus the Velluma demo). | `api/ai-chat/route.ts` ~84–104 | `crons-assistant` "someone active in two companies can use the assistant" |
| 70 | Low | A suspended workspace can still use the assistant (Sollos's Anthropic key). | same | "a member of a suspended workspace is refused" |
| 71 | Low | Comped workspaces (billing override) are emailed that their trial is ending; paying subscribers can be too. | `api/cron/trial-expiring/route.ts` ~128, ~172–187 | `crons-digests-trials` (2 tests) |
| 72 | Low | Trial reminders the email service refused are counted as sent. | same, ~85–91 | "a reminder Resend refused is not counted as sent" |
| 73 | Low | An owner of two opted-in companies gets the weekly changelog twice. | `lib/product-changelog.ts` ~175–249 | "an owner of two opted-in companies gets one copy" |

### People: employees, hiring, training, time, bonuses, sign-in

| # | Sev | What's wrong | Where | Shown by |
|---|---|---|---|---|
| 74 | High | Force-removing an employee deletes their whole login, which removes them from every other company they belong to. Another action already guards this case. | `employees/actions.ts` ~1096–1107 | `people-account` "force remove never reaches the same person's membership in another company" |
| 75 | Med | The efficiency bonus compares each cleaner's minutes with the one-person estimate: two cleaners who each worked their half of a divided job are both paid for "saving" time. Overpays every team job. | `bonuses/actions.ts` ~236–276 | `people-time` "two cleaners who each worked their half of a divided job saved nothing" |
| 76 | Med | A review bonus is skipped if efficiency bonuses were computed first for the same period (the "already awarded" check ignores the type). | `bonuses/actions.ts` ~78–87 | "…gets her review bonus even when efficiency was computed first" |
| 77 | Med | Computing efficiency bonuses fails past about 320 finished jobs in the window (one over-long request). | `bonuses/actions.ts` ~207–213 | "a company with 400 finished jobs in the window still gets its efficiency bonuses" |
| 78 | Med | Marking a new hire trained on an expiring module (WHMIS, first aid) sets no certificate expiry, so no reminder ever comes; the expiry trigger runs on update only. | `training/actions.ts` ~398, migration `20260420030000` ~80 | `people-hiring` "marking a new hire trained … dates her certificate…" |
| 79 | Med | Replacing a training step's photo with one that's refused wipes the old photo and says saved. | `training/actions.ts` ~251–262 | "replacing a step's photo with one too big to keep leaves the old photo (or says no)" |
| 80 | Low | A manager (Olha) opening a shift's history sees "no entries": the audit log is read through rules that only let owners and admins see it. | `timesheets/actions.ts` ~101–111 | `people-time` "a manager opening a shift's history sees its edits…" |
| 81 | Low | An admin pressing "finish setup" saves nothing and is sent on as done. | `setup/actions.ts` ~12–21 | `people-account` "an admin finishing setup really finishes it" |
| 82 | Low | Sign-in sends a cleaner to /app first (reads the whole company's memberships), and /app bounces them to /field. | `(marketing)/login/actions.ts` ~135–147 | "lands a cleaner on /field" |
| 83 | Low | A certificate first seen inside 7 days gets the 7-day reminder, then a "30-day" one the next morning. | `lib/automations.ts` ~6230 | "a certificate first seen a week out is reminded once…" |
| 84 | Low | Bonuses: a second "mark paid" re-stamps the paid date; marking, editing or deleting another company's bonus answers ok (and logs). | `bonuses/actions.ts` ~360–641 | `people-time` (3 tests) |
| 85 | Low | Training: no role check on edit or delete (a cleaner is told "saved"), a delete that didn't happen is logged, and an edit aimed at another company's module can attach steps to it. | `training/actions.ts` ~209–327 | `people-hiring` (3 tests) |
| 86 | Low | Timesheet manager actions ignore a manager's Timesheets switch. | `timesheets/actions.ts` | "a manager whose timesheets access is switched off can't…" |
| 87 | Low | Applicant status and notes, and hiring-document edits, answer ok when they reached nothing; a hiring-doc delete that didn't happen is logged. | `applicants/actions.ts` ~119–153, `hiring/actions.ts` ~53–106 | `people-hiring` (3 tests) |

### Test suite

| # | Sev | What's wrong | Where |
|---|---|---|---|
| 88 | Low | `test/db/invoice-auto-send.api.test.ts` doesn't set `NEXT_PUBLIC_SITE_URL` or stub fetch, so its PDF step may call `https://sollos3.com/api/i/<test token>/pdf` for real (production answers 404). Tests should never reach production. | `test/db/invoice-auto-send.api.test.ts`, `lib/invoice-send.ts` ~105, ~178 |

## Questions (possible faults, not yet decided)

- **Invoice emails and trials:** when the email service is down, an auto-send invoice is left "held" and nobody is told (the code's comments disagree on whether it retries). The review digest and monthly digest have no "already sent today" marker. The monthly digest counts by UTC month. The review digest lists drafts even when auto-send is off. Trial emails say "ends today" two days running. The changelog's 9 AM gate uses `America/Edmonton` (check against the Alberta UTC-6 change). A malformed `org_id` on the purge tool answers 500.
- **People:** pressing "Compute review bonuses" again on a later day pays the same reviews again over an overlapping window. An owner can force-remove an active co-owner. Several deletes give no message when refused (revoke invite, applicant, hiring doc, training module). Un-ticking training leaves the certificate expiry, so reminders continue. A cleaner can move a future time-off request into the past. The certificate reminder stamps "sent" without checking the email went. Bonuses are computed for deactivated people. Sign-up needs 10-character passwords; join and reset need 8. The PTO balance code calls an RPC no migration creates.
- **Office tools:** review and feedback emails/pushes are fired without waiting (the chat code notes these get frozen on Vercel). Reviews, packages and inventory pages show editing to owner/admin only, but the code lets managers. A review can name another company's client. The morning check trims old log rows for every company. Cancelling an offer could overwrite one filled at the same moment. The feed's delete error tells a manager that "a manager" can delete it, then refuses.

- **Clients:** contract links never expire, and a cancelled contract can still be signed. A signed contract stays editable and deletable. Re-sending a signed contract asks the client to sign again. The manager "clients" switch isn't checked by documents, properties, Google review buttons, SMS opt-in or home media. Import keeps phones as typed, not tidied. The opt-in text can go to a client who replied STOP. The Google review first ask isn't limited to a client's first job. The Google review job has the same 500-row stall as #33/#34. Google review buttons log audit entries when nothing changed. Contract `service_type_id`/`estimate_id` aren't checked against the company.
- **Payments:** Stripe refunds carry no idempotency key (two presses at once could both refund; Square guards this). Invoice link expiry isn't enforced by the PDF route or Pay buttons (nothing sets it yet). The invoice PDF shows no status and the total, not the balance. A partial refund reopens the balance and shows a Pay button (deliberate per the code). Billing checkout doesn't refuse a second subscription. Several connection writes aren't checked. The Stripe checkout idempotency key ignores the account and fee, so a same-day reconnect could block payments for a day.

- **Recurring invoices:** pausing doesn't stop back-billing: resume leaves the next run in the past, so missed periods are billed after resume (same for a start date in the past). Managers see a Delete button that silently does nothing. Line items aren't checked against the amount.
- **Settings:** some refusals (webhook with an unsafe URL, toggles, prefs) show no message. A cleaner pressing a bonus rule save sees a raw database error; managers can edit bonus pay with no capability switch.
- **API:** `status: "paid"` is accepted with no payment recorded.
- **Integrations:** any member, a cleaner included, can send "request an integration" emails (no role check, no rate limit). Reconnecting Sage or QuickBooks drops the saved tax region and account map. A cleaner's "Re-sync my calendar" misses jobs that name them only as the assigned cleaner (no crew row). After QuickBooks/Sage create an invoice, saving its id isn't checked, so a failure could book a duplicate next time. If Google's "who is this" call fails, a different account's tokens replace the old ones without clean-up. Admin route comments still mention `?secret=`.
