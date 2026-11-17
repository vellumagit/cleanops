# Fix-later pile

Started 16 Nov 2026, during the push to finish testing. The rule while
testing: a test that finds a fault does not fix it. The fault goes here, and
the test that shows it is marked `it.fails(...)` with a `FIX-LATER` comment.
The suite stays green, and when someone fixes the fault, that test starts
failing, which is the reminder to turn it back into a normal `it(...)`.

Severity: **High** = money, privacy or another company's data at risk;
**Med** = wrong result someone will notice; **Low** = wording, edge cases.
Faults marked **Security** should go first.

## What's left (17 Nov, after the seventh group)

All 106 known-fault tests are now normal tests. Nothing in the suite is
marked as an expected failure.

One thing to do by hand: a recurring invoice that had ALREADY drifted from
the 31st to the 28th keeps the 28th (the new column takes the day it bills
on today). Open it and pick its date again to put it back.

**Not tests, still open:**
- Same-name website visitors are filed under an existing client (#1, the
  rule itself; your call).
- Booking saves don't wait for the calendar sync (#2); the expired-estimate
  banner (#3); the raw message on an archived estimate (#4); the Reports
  page totals past 1,000 rows (#89) and the other large-size reads (#90);
  two test-suite items (#88, #91).
- The April webhooks migration never ran in production, and the leftover
  `membership_admin_notes` table.
- The data export (Settings, "download my data") lists the same tables the
  purge used to: about thirty tables, client addresses among them, are not
  in the download. Found 17 Nov while fixing the purge; not fixed.
- Your two decisions (service rename; series extension when the cleaner is
  busy) and the "Questions" section at the bottom.
- Things to check in real use: cleaners starting jobs and Olha editing
  bookings under the restored rules (17 Nov catch-up); tasks whose times
  were shifted before the fix need correcting by hand; efficiency bonuses
  already paid on team jobs may have been too generous.
- The computer: it lost power under test load on 17 Nov. Full runs now use
  4 workers. Worth getting the cooling or power supply looked at.

## Fixed so far

- **17 Nov, first six:** Google Calendar connect now uses a sealed one-time
  state (#20); the company's Disconnect leaves cleaners' calendars alone
  (#22); part-prepaid invoices are auto-sent and stay part-paid (#66);
  deactivated people get no pushes, in chat or anywhere else (#51); task
  times are read and shown in the company's timezone, a reminder re-arms
  only when its time changes, and a task save that saved nothing says so
  (#52, #56); a recurring invoice must be for one of the company's own
  clients, and one that fails no longer stops the night's run (#5, #6).
  Each fault's test is now a normal test.
- **17 Nov, second group:** both unsubscribe links work (the rebooking one,
  #29, and the weekly product email's, which had the same mistake);
  force-remove keeps a login that another company also uses (#74);
  checklists can't be assigned, edited or attached across companies, and
  say when nothing changed (#31, #32, #37, #43, #44); the QuickBooks and
  Sage sync buttons take only the company's own, non-void invoices and
  respect the Invoices switch (#21, #24, #25); client import respects the
  daily cap and the disposable-address screen, and no longer duplicates
  past 1,000 clients or within one file (#30, #35, #45); switching Google
  accounts sends jobs to the new calendar (#23).
- **17 Nov, third group:** on-call contacts' phone numbers are saved as
  North American numbers (#55); bonuses: the review bonus is no longer
  blocked by an efficiency bonus, efficiency compares each person with their
  own share of a team job, and it works past 320 jobs (#75, #76, #77); the
  owner is told when an auto-send invoice's client can't be reached (#67);
  a retried photo "finish" keeps the file (#36); booking review requests and
  the rebooking prompt look at every eligible job and client (#33, #34); a
  cleaner can't take over a task (#53: code check live with the push, the
  database rule needs migration `20261117010000`).
- **17 Nov, fourth group:** recurring invoices: the picked date is that
  date in the company's calendar, the due date counts from the company's
  day, lines written like the old example bill correctly (and the example
  is fixed), managers need the Invoices switch, and a save that saved
  nothing says so (#7, #8, #9, #11, #12; #10 month-end drift still open, it
  needs an anchor-day column); company deletion compares the typed name with
  the real company's (#16); a sender-email save refused by the daily limit
  changes nothing (#17); a cleared SMS cap is refused (#50); every address
  on a bounce is blocked (#48); public API: invoice.paid fires once, a bad
  PDF saves nothing, missing or malformed ids answer 404 (#13, #14, #15);
  `_` and `%` in a website visitor's email or name no longer match other
  clients (part of #1).
- **17 Nov, fifth group:** contracts: deleting one removes its documents'
  files, a document can't be attached to another company's contract or left
  behind when its record fails, two signs at once sign it once, and a save
  that saved nothing says so (#38–#42); office lists: reviews, packages,
  inventory, network and on-call contacts say when nothing changed and log
  nothing false, the on-call buttons respect the manager switch, pinning
  someone else's post is refused in words, and the new-review notice names
  the cleaner (#57–#61); people: bonuses answer "not found" for another
  company's and keep the first paid date, applicant and hiring-document
  saves say when they reached nothing, a manager sees a shift's history, an
  admin can finish setup, and sign-in sends a cleaner straight to /field
  (#80, #81, #82, #84, #87).
- **17 Nov, sixth group:** the purge of deleted companies now clears every
  table that carries the company's id (about thirty were left behind), no
  longer trips on the dropped webhook table, batches a delete that times
  out, and reports a failed purge as failed; a test compares its table list
  with the database so a new table can't be forgotten (#62–#65). Training:
  only the office can edit or delete a module, an edit aimed at another
  company's module changes nothing, a refused photo keeps the old one, and
  marking a new hire trained dates the certificate (#78, #79, #85; no
  migration was needed in the end). The admin calendar repair tool uses only
  the company calendar, leaves another company's events alone, and finishes
  past 40 events (#26–#28). Square: the 30-day token refresh keeps the
  connection, refunds are asked for in the company's currency, and both
  refund buttons log against the payment's own invoice (#46, #47, #49). The
  assistant works for someone in two companies and refuses a suspended
  workspace; comped and paying workspaces get no "trial ending" email;
  refused reminders aren't counted as sent; the changelog goes once per
  person (#69–#73). Two overdue runs at once remind once (#68); timesheet
  and time-off actions respect the manager's Timesheets switch (#86); a
  certificate first seen inside a week gets one reminder (#83); archiving a
  service that isn't ours logs nothing (#19).
- **17 Nov, seventh group (the last known-fault tests):** a team
  announcement is read per person, so "mark all read" and a single press
  clear it only for whoever pressed (#54; new table notification_reads, and
  the bell's count reads it); recurring invoices aim for the series' anchor
  day, so the 31st comes back after February (#10; new column
  invoice_series.anchor_day); the sender verification link expires after
  the 24 hours its email promises (#18; the issue time rides in the link,
  no database change). Migration:
  20261117020000_notification_reads_and_anchor_day.sql.
- **17 Nov, the six decisions (all answered "yes" by Brian):**
  1. A website visitor who shares a name with a client but has a different
     email gets a record of their own; the same name is taken as the same
     person only when one side has no email, and then the email is kept (#1).
  2. Renaming a service renames upcoming visits and recurring series that
     use it; past visits keep the name they were done under.
  3. When a series is extended and its cleaner is already booked, the visit
     is made with no cleaner and named in the morning email, instead of
     being skipped.
  4. Resuming a paused recurring invoice moves its next date forward to the
     first one not in the past, so the paused months are not billed.
  5. A cancelled contract can't be signed or sent for signature; a signed
     contract's terms can't be edited (its status still can).
  6. "Compute review bonuses" skips anyone who already has a review bonus
     whose period reaches into the window, as the weekly job already did.
- **17 Nov:** the production catch-up (see the next section).

## Waiting on you

- **Run `supabase/migrations/20261117010000_tasks_update_own_or_office.sql`**
  in the SQL editor. It stops a cleaner taking over someone else's task
  through the API (the app itself already refuses). Until it runs, the drift
  check will list one "policy differs" row for tasks; that row is this.
- **Whenever a migration adds or changes an access rule**, regenerate
  `docs/production-drift-check.sql` (it is a snapshot of the rules the
  migrations build).

- **Managers migration.** `supabase/migrations/20261116060000_managers_update_estimates_invoices.sql`
  gives managers (Olha) back the right to change estimates and invoices. The
  code shipped in 99b679b works either way; until it runs, a manager's save
  says "wasn't saved" instead of saving.
- **Elena and Promotional billing day** (from my notes, Nov 10): reset both
  clients' billing day to blank after the Nov 15 monthly run. It may already
  be done.

- **DONE 17 Nov: the catch-up migration (`20261116070000`) was run in production, and the drift check afterwards returned only the expected leftovers (regexp_* and rls_auto_enable functions, membership_admin_notes, the webhook rules). The member-wide edit rules are gone and the September and October guards are in place. Still open from this item: the April webhooks migration, and the leftover `membership_admin_notes` table. The history below is kept for the record.**
- **Production drift, confirmed by `docs/production-drift-check.sql` (run 16
  Nov). Fix this first: it is a live security gap, and until it's fixed the
  tests describe a stricter database than the one Svit is on.**
  - **Never ran in production:**
    - `20260913030000_insider_guards.sql`. None of its guards exist: a
      cleaner limited to a job's status and notes, only an owner may make or
      change an owner, a cleaner can't insert time entries for others, and the
      client must belong to the same company (bookings, invoices, estimates,
      contracts). Its removal of the "employees can insert own pto requests"
      rule (which let a cleaner insert an approved request for 9,999 hours)
      didn't happen either.
    - `20260914010000_profitability_reports.sql`: the two report functions
      don't exist, so those reports can't load.
    - `20261007020000_crew_update_bookings.sql`: production still has the old
      "admins or assignee update bookings" rule.
    - `20260421020000_webhooks_unification.sql`: no one uses webhooks yet.
  - **Hand-made rules in production, in no migration (wording confirmed by
    `docs/production-policy-check.sql`, 16 Nov):** "Members can update their
    org bookings", "…estimates" and "…invoices". Each is permissive, for every
    role, and checks only that the row is in the member's company (their
    first active membership, `LIMIT 1`), never their role. Measured on a copy
    shaped like production (`test/db/catch-up-production.api.test.ts`):
    **bookings**: any active member, a cleaner included, can change any
    booking in their company through the API, the price included (with the
    insider guards missing, nothing limits the columns). **Invoices and
    estimates**: cleaners can't read them (the Nov 10 office-only read
    rule), so they can't single one out; but an edit with no filter needs no
    read and rewrote every invoice in the company at once on the copy.
    Whether production's API refuses filterless edits (an optional Supabase
    safeguard) can't be seen without trying a write there.
  - **FIX READY: `supabase/migrations/20261116070000_catch_up_production.sql`.**
    Run it in the SQL editor, then run `docs/production-drift-check.sql`
    again: only these rows should remain (none of them touched by the fix):
    `function extra` regexp_* (5) and rls_auto_enable (Supabase's own);
    `policy extra` membership_admin_notes, the two webhook_subscriptions
    rules and the old webhook_deliveries rule; `policy missing`
    webhook_deliveries org_admins_read_webhook_deliveries. At Svit that is 10 cleaners and 2
    managers. It needs the API used directly with their own sign-in (not
    possible through the app's screens), and there's no sign of use. Time-off
    requests show none (no approved request without an approver, none over
    16 hours), and bookings, estimates and invoices don't record who changed
    them, so they can't be checked.
  - **Why the app works today despite the missing October rule:** managers'
    and crew members' booking edits, and managers' estimate and invoice
    edits, go through these member-wide rules. Drop them and add the correct
    rules in the same step, or those edits stop.
  - **Missing rules that matter less:** owner/admin read rules on payroll
    runs and items, and the subcontractor bill and payout read rules (other
    rules or the service key may cover these; check before relying on it).
  - **Nothing live calls a missing function:** `memberships_owner_guard`
    exists (from the Nov 11 migration) but has no trigger, so its call to the
    missing `is_service_role` never runs.
  - **Why a catch-up and not a replay:** the Sep 13 file's
    `memberships_owner_guard` still compares `pay_type`, which the Nov 11
    migration dropped, so replaying it would break every admin editing their
    own membership. The catch-up was generated from the database the
    migrations build today, and proven on a copy built with production's
    real rules (the test above).
  - The managers migration (`20261116060000`) did run in production: its
    estimate and invoice rules match the migrations word for word.
- **Earlier read-only API comparison (16 Nov), kept for the record:**
  - **Webhooks (Apr 21) never ran:** `webhook_subscriptions` still exists and
    `webhook_deliveries` has its old columns. No company uses webhooks yet.
  - **Four functions the migrations create aren't there:** `is_service_role`
    (Sep 13 insider guards), `report_job_profitability` and
    `report_cleaner_scorecard` (Sep 14 profitability reports), and
    `is_booking_crew` (Oct 7, managers' and crew's booking edits). A November
    function is found, so the API's list is current. If those migrations
    really never ran, production lacks the insider guards (a cleaner limited
    to status and notes; the client must belong to the company) and the
    October booking-edit rules, and the profitability reports can't load.
    The API can't show triggers or rules, which is what the SQL check is for.
  - **Leftovers:** a `membership_admin_notes` table (2 rows of employee notes)
    exists only in production; `memberships.address` still exists there,
    though empty (0 of 59 filled), so no home addresses are exposed.
  - Tables and columns otherwise match (100 in production, 98 from the
    migrations; the two extra are the leftovers above).

## Decisions for you

None open. The two that were here (service rename; series extension when
the cleaner is busy) were decided and built on 17 Nov, with four more from
the Questions section; see "Fixed so far".

Left as it was, on purpose: a signed contract can still be DELETED. Say if
that should be refused too.

## Faults

### Website forms, leads, estimates

| # | Sev | What's wrong | Where | Shown by |
|---|---|---|---|---|
| 1 | FIXED 17 Nov (was Med) | A new person who shares a name with an existing client but has a different email is filed under that client: their email and phone are saved nowhere, and "Send estimate" would email the quote to the other person. The email match also uses `ilike`, so `_` in an address is a wildcard (`m_underwood@` lands on `m.underwood@`). Fix: match by name only when one side has no email; compare emails exactly. | `src/lib/find-or-create-client.ts` | `settings-api-v1` "a visitor whose email only looks like an existing client's gets a lead of their own" |
| 2 | Low | Booking create, edit and skip start the Google Calendar sync without waiting; the redirect can end the function first. The nightly reconcile repairs misses. Fix: wrap in `after()`. | `src/app/app/bookings/actions.ts` (`syncMemberCalendarEvents(...).catch`) | — |
| 3 | Low | An estimate the expiry job marks expired still shows "Valid until …" on the client's page (reads `expires_at`, not status). Svit has auto-expire off. | `src/app/e/[token]/page.tsx` | — |
| 4 | Low | Saving an archived estimate shows the raw database message instead of plain words. | `src/app/app/estimates/actions.ts` | — |

### Recurring invoices (Settings → Recurring invoices, nightly job)

| # | Sev | What's wrong | Where | Shown by |
|---|---|---|---|---|
| 5 | FIXED 17 Nov (was High) | A recurring invoice can be set up for another company's client: the action doesn't check the client, and `invoice_series` lacks the client-company guard `invoices` has. | `settings/recurring-invoices/actions.ts` create + update | `settings-recurring-invoices` "never makes a series for another company's client" |
| 6 | FIXED 17 Nov (was High) | One recurring invoice that fails to save stops the whole nightly run: its period is skipped silently, and every company later in the run gets no invoice that night. Fix: catch per series and give the period back. | `src/lib/automations/billing.ts` ~715–745 | "…gives its period back and doesn't stop other companies' invoices" |
| 7 | FIXED 17 Nov (was Med) | The form's line-item example uses `description`/`unit_cents`; the job reads `label`/`unit_price_cents`. Lines written like the example bill at $0 under a correct total. | `recurring-invoices/form.tsx` placeholder vs `billing.ts` ~768–790 | "…bills lines that add up to the invoice" |
| 8 | FIXED 17 Nov (was Med) | Recurring-invoice buttons ignore a manager's Invoices switch. | `recurring-invoices/actions.ts`, `page.tsx` | "a manager with Invoices & estimates switched off can't make a standing invoice" |
| 9 | FIXED 17 Nov (was Med) | The first-run date is saved as UTC midnight, a day early in Alberta: the list shows Nov 30 for Dec 1. | `recurring-invoices/actions.ts` ~89, ~163 | "the first invoice date … is that date in the company's own calendar" |
| 10 | FIXED 17 Nov (was Low) | Month-end series drift to the 28th after February, though the code says it prevents that. | `billing.ts` ~622–652 | "…stays on the last day after a short month" |
| 11 | FIXED 17 Nov (was Low) | Due date counts from UTC's day, not the company's (hidden for Alberta by the run time). | `billing.ts` ~613–616 | "counts the due date from the company's day…" |
| 12 | FIXED 17 Nov (was Low) | A save that matched no series reports success. | `recurring-invoices/actions.ts` ~155–184 | "a save that matched no series says so…" |

### Public API (API keys)

| # | Sev | What's wrong | Where | Shown by |
|---|---|---|---|---|
| 13 | FIXED 17 Nov (was Med) | The `invoice.paid` webhook re-fires on every later edit of a paid invoice (double bookkeeping in connected tools). | `api/v1/invoices/[id]/route.ts` ~100–126 | `settings-api-v1` "invoice.paid goes out once…" |
| 14 | FIXED 17 Nov (was Med) | A bad PDF answers 400, but the estimate (and a new lead) is already saved, so retries duplicate. | `api/v1/estimates/route.ts` ~165–208 | "a PDF that isn't one is refused before the estimate is made…" |
| 15 | FIXED 17 Nov (was Low) | Editing another company's or a missing invoice/estimate answers 500, not 404; a malformed id crashes the route. Nothing is changed. | `api/v1/*/[id]/route.ts` | "…answers 404, not a server error"; "a malformed id answers 404…" |

### Other settings

| # | Sev | What's wrong | Where | Shown by |
|---|---|---|---|---|
| 16 | FIXED 17 Nov (was Med) | Company deletion compares the typed name with a name the page sent, then schedules whichever company is active: an owner of two companies with a stale tab can schedule the wrong one (30-day grace applies). | `settings/data/actions.ts` ~20–32 | `settings-actions` "the name typed must be the name of the company being deleted" |
| 17 | FIXED 17 Nov (was Med) | A sender-email save refused by the daily limit still replaces and unverifies the sender, killing the link already emailed. | `settings/email/actions.ts` ~83–109 | "a save refused by the daily limit leaves the verified sender as it was" |
| 18 | FIXED 17 Nov (was Low) | The sender verification link never expires, though its email says 24 hours. | `api/verify-sender/route.ts` | "the link stops working after the 24 hours its email promises" |
| 19 | FIXED 17 Nov (was Low) | Archiving or unarchiving a service that isn't ours still writes an audit entry. | `settings/services/actions.ts` ~185–233 | "archiving a service that isn't ours leaves no 'archived' entry…" |

### Integrations (Google Calendar, QuickBooks, Sage)

| # | Sev | What's wrong | Where | Shown by |
|---|---|---|---|---|
| 20 | FIXED 17 Nov (was High, Security) | Google Calendar connect uses the person's membership id as its OAuth state, not a one-time secret. Anyone who knows an owner's id (a teammate, an ex-employee) can connect that company's calendar to their own Google account and receive every job (client names, addresses, notes); the same works against a cleaner's personal calendar. Fix: `issueOAuthState`/`consumeOAuthState`, as QuickBooks and Sage do. | `settings/integrations/google-calendar-actions.ts` ~30, `field/profile/actions.ts` ~124, `api/integrations/google-calendar/callback/route.ts` | `integrations-oauth` (3 tests: forged state cookie, callback never started, teammate takeover) |
| 21 | FIXED 17 Nov (was High, Security) | "Sync to QuickBooks/Sage" doesn't check the invoice belongs to the caller's company: any office person can book another company's invoice (even a draft) into that company's books, and the error leaks its client name. | `invoices/actions.ts` ~1139, ~1175; `lib/quickbooks.ts` ~574, `lib/sage.ts` ~806 | `integrations-sync` "another company's invoice id books nothing into their QuickBooks / Sage" |
| 22 | FIXED 17 Nov (was Med) | The company's Google Disconnect also switches off every cleaner's own calendar connection. Fix: `.is("membership_id", null)`. | `google-calendar-actions.ts` ~57–62 | `integrations-oauth` "the company's Disconnect leaves each cleaner's own calendar connected" |
| 23 | FIXED 17 Nov (was Med) | After switching Google accounts, a 30-second token cache pushes the jobs back onto the old calendar; the new one stays empty. | `lib/google-calendar.ts` ~274–290 | "reconnecting with a different Google account moves the company's jobs…" (+ cleaner version) |
| 24 | FIXED 17 Nov (was Med) | A voided invoice can be booked into QuickBooks/Sage as revenue (from a stale page). | `lib/quickbooks.ts` ~611, `lib/sage.ts` ~847 | "a voided invoice is not booked into QuickBooks / Sage" |
| 25 | FIXED 17 Nov (was Low) | Sync buttons ignore a manager's Invoices switch (other invoice actions don't check it either). | `invoices/actions.ts` ~1139, ~1175 | "a manager with invoicing switched off can't push an invoice into the books" |
| 26 | FIXED 17 Nov (was Med) | Admin repair tool gcal-force-resync finds no company calendar once any cleaner has connected their own; with only cleaners connected, it wipes a cleaner's calendar. | `api/admin/gcal-force-resync/route.ts` ~44–60 | `integrations-gcal-admin` (2 tests) |
| 27 | FIXED 17 Nov (was Med) | gcal-force-resync deletes another company's live events on a shared calendar. | same, ~139–167 | "…the other company's live events stay" |
| 28 | FIXED 17 Nov (was Low) | gcal-force-resync never finishes past 40 events. | same, ~150 | "with more than 40 jobs, running it again…" |

Live exposure (production, read-only, 16 Nov): the only connected
integration anywhere is Svit's Google Calendar, company plus 8 cleaners'
own. So #20, #22 and #23 touch Svit today; #21 and #24–#25 (QuickBooks/Sage)
touch no one yet.

### Clients, checklists, contracts, client emails

| # | Sev | What's wrong | Where | Shown by |
|---|---|---|---|---|
| 29 | FIXED 17 Nov (was High, Legal) | The unsubscribe link in rebooking emails does nothing: `if (rl)` is always true, so POST returns before unsubscribing and GET always answers 429. This is the CASL / one-click unsubscribe link. Live: one Svit client was ever nudged (April). Fix: `if (!rl.allowed)`. | `api/u/m/[token]/route.ts` ~64, ~75 | `clients-review-crons` "the unsubscribe link in the email stops the next one" |
| 30 | FIXED 17 Nov (was High) | Client import skips the daily new-client cap and the disposable-email check (the abuse route from 11 Sep). A new workspace imported 250 where the cap is 200. | `clients/import/actions.ts` ~238 | `clients-records` "a workspace in its first week can't import past its 200-new-clients-a-day limit" |
| 31 | FIXED 17 Nov (was High) | Assigning a checklist with another company's client id reports ok, and the service-role backfill copies this company's items onto that company's upcoming jobs. | `checklists/actions.ts` ~410–424 | `clients-checklists-contracts` "a client id from another company can't be given this company's checklist" |
| 32 | FIXED 17 Nov (was High) | Editing another company's checklist template id inserts items into it, and their next job copies them. | `checklists/actions.ts` ~214–251 | "editing another company's template id changes nothing there and says so" |
| 33 | FIXED 17 Nov (was Med) | Booking review requests stall: the job reads the 200 oldest unasked jobs across all companies, and skipped ones (switched off, house default "none") are never stamped, so they hold the window. Svit's default "none" fills it. | `lib/automations.ts` ~1968–1986 | `clients-review-crons` "…reach a company switched on even when 200 older jobs elsewhere will never be asked" |
| 34 | FIXED 17 Nov (was Med) | The rebooking prompt only ever looks at the first 500 clients (no order, never advances). | `lib/automations.ts` ~1243 | "the rebooking prompt reaches a client past the first 500…" |
| 35 | FIXED 17 Nov (was Med) | Re-importing a list creates duplicates past 1,000 existing clients (the API's row cap). | `clients/import/actions.ts` ~211 | `clients-records` "re-importing a 1,200-client list adds nobody…" |
| 36 | FIXED 17 Nov (was Med) | A retried photo "finish" deletes the file the first save recorded, leaving a broken photo. | `lib/client-media-actions.ts` ~159 | "finishing the same upload twice (a retry) keeps the file…" |
| 37 | FIXED 17 Nov (was Med) | A checklist template can be put on another company's job. | `checklists/actions.ts` ~325–372 | "a template can't be put on another company's job" |
| 38 | FIXED 17 Nov (was Med) | Deleting a contract leaves its document files in storage. | `contracts/actions.ts` ~129 | "deleting a contract takes its documents' files with it" |
| 39 | FIXED 17 Nov (was Med) | Contract documents can be attached to another company's contract. | `contracts/document-actions.ts` ~26–62 | "a document can't be attached to another company's contract" |
| 40 | FIXED 17 Nov (was Low) | Two signs submitted at once both sign: the second overwrites the first's evidence and the office is told twice. | `c/[token]/sign-actions.ts` ~131 | "two submits at the same moment sign it once" |
| 41 | FIXED 17 Nov (was Low) | A contract save that changed nothing looks saved. | `contracts/actions.ts` ~106 | "a contract save that changed nothing says so…" |
| 42 | FIXED 17 Nov (was Low) | A contract document whose record fails to save leaves its file behind. | `contracts/document-actions.ts` ~52 | "a document whose record can't be saved leaves no file behind" |
| 43 | FIXED 17 Nov (was Low) | Taking a checklist off a client that isn't ours reports success. | `checklists/actions.ts` ~447 | "taking a checklist off a client that isn't this company's says nothing changed" |
| 44 | FIXED 17 Nov (was Low) | Removing another company's checklist item reports ok. | `checklists/actions.ts` ~520 | "removing another company's checklist item says it wasn't removed" |
| 45 | FIXED 17 Nov (was Low) | A person listed twice in one CSV becomes two clients. | `clients/import/actions.ts` ~222 | "a person listed twice in the same file becomes one client" |

### Payments, refunds, texting, email bounces

| # | Sev | What's wrong | Where | Shown by |
|---|---|---|---|---|
| 46 | FIXED 17 Nov (was High (nobody on Square yet)) | Square disconnects itself when its 30-day token runs out: the refresh saves `connected_by: ""`, the insert fails, and the old row was already retired. Clients' Pay button fails; refunds crash. | `lib/square.ts` ~447, ~352–369 | `payments-public` + `payments-refunds` (token run out) |
| 47 | FIXED 17 Nov (was Med (nobody on Square yet)) | Square refunds are always requested in CAD; a USD company's refunds fail. | `lib/square-refunds.ts` ~135 | `payments-refunds` "a US-dollar company's refund is asked for in US dollars…" |
| 48 | FIXED 17 Nov (was Med) | A bounce or complaint naming several addresses only blocks the first, though the reply says all; the app keeps emailing the rest. | `api/webhooks/resend/route.ts` ~166, `lib/email-suppression.ts` ~86 | `payments-public` "a bounce that names two addresses puts both on the list…" |
| 49 | FIXED 17 Nov (was Low) | The refund audit entry uses the invoice id posted with the form, not the payment's own invoice. | `invoices/actions.ts` ~689, ~741 | `payments-refunds` "the audit entry names the payment's own invoice…" |
| 50 | FIXED 17 Nov (was Low) | A cleared SMS cap field saves as $0 ("Cap saved."), silently stopping every text past the included allotment. | `settings/sms/actions.ts` ~166 | `payments-sms` "a cleared cap field is refused, not saved as $0…" |

### Office tools, tasks, team chat, reviews, on-call pool

| # | Sev | What's wrong | Where | Shown by |
|---|---|---|---|---|
| 51 | FIXED 17 Nov (was Med, Privacy) | Deactivated cleaners still get team chat pushes (#general and announcements, with the message preview): pushes go to every thread member whatever their status, and deactivation never removes them. Svit has deactivated cleaners (Olga, for one). | `lib/chat-actions.ts` ~217–262 | `ops-team-jobs` "doesn't buzz the phone of a cleaner who has been deactivated" |
| 52 | FIXED 17 Nov (was Med) | Saving a task moves its due and reminder times 6 hours earlier: the form's time is stored as UTC, so 9:00 AM becomes 3 AM Alberta, and every save shifts it again. | `tasks/actions.ts` ~139, `lib/validators/tasks.ts` | `ops-team-jobs` "opening a task and saving it unchanged keeps its due time and reminder" |
| 53 | FIXED 17 Nov (was Med) | A cleaner can take over any task by assigning it to themselves: the task update policy admits any member, and the action has no role check. | `tasks/actions.ts` ~122–145, migration `20260514010000_tasks.sql` ~92 | "a cleaner can't take over a task that isn't hers" |
| 54 | FIXED 17 Nov (was Med) | One person's "mark all read" clears the team announcement for everyone (an org-wide notice is one row), though the code promises it doesn't. | `notifications/actions.ts` ~26–36, `lib/notify.ts` ~236 | "the owner marking everything read leaves the team announcement unread for the manager" |
| 55 | FIXED 17 Nov (was Med) | An on-call contact's phone typed without +1 ("780 271 1971") is saved as `+7802711971`, a Russian number, so shift-offer texts go astray. `lib/phone.ts` fixed this elsewhere. | `lib/validators/freelancer.ts` ~13–20 | `ops-office-lists` "a local ten-digit number is saved as the North American number it is" |
| 56 | FIXED 17 Nov (was Low) | Editing a task whose reminder already went sends it again. | `tasks/actions.ts` ~142 | "editing a task whose reminder already went doesn't send it again" |
| 57 | FIXED 17 Nov (was Low) | Managers with the on-call pool switched off can still add, change and remove contacts, and cancel offers. | `freelancers/actions.ts` | "a manager without the on-call pool can't…" (2 tests) |
| 58 | FIXED 17 Nov (was Low) | Deleting an on-call contact logs a deletion that didn't happen (e.g. a cleaner's press). | `freelancers/actions.ts` ~153 | "a delete that removed nothing leaves no 'deleted' in the history" |
| 59 | FIXED 17 Nov (was Low) | A manager pinning someone else's post is told "Pinned", but nothing changes (the database allows only the author or owner/admin). | `lib/feed-actions.ts` ~163 | "a manager pinning someone else's post either pins it or is told she can't" |
| 60 | FIXED 17 Nov (was Low) | The owner's new-review notice never names the cleaner (looks up a profile by a membership id). | `reviews/actions.ts` ~50 | "the owner's notice names the cleaner the review is for" |
| 61 | FIXED 17 Nov (was Low) | Saves that matched nothing still report success: review corrections, packages, inventory, network contacts (plus a false "update" audit entry), on-call contacts. | `reviews` ~115, `packages` ~63, `inventory` ~56, `network` ~76, `freelancers` ~108 | `ops-office-lists` "a save that changed no … says so" (5 tests) |

### Invoice emails, trials, company purge, assistant

| # | Sev | What's wrong | Where | Shown by |
|---|---|---|---|---|
| 62 | FIXED 17 Nov (was High) | Purging a deleted company leaves its personal data in about 17 tables the purge doesn't list (job applicants with résumés, text messages, prepayments, AI conversations, API keys, intake forms…): the company row is kept as a tombstone, so database cascades never fire. Right-to-erasure. Fix: add them, plus a test comparing the list with the real tables. | `lib/tenant-data.ts` ~517–591 | `crons-admin-purge` "leaves none of the org's personal data behind…" |
| 63 | FIXED 17 Nov (was High (not live: see drift)) | The purge list still names `webhook_subscriptions`, which the migrations dropped, so against the migrated schema every purge stops before the tombstone and before erasing members' logins, and `admin/purge-org` always answers not-ok. Production still has the table (drift), and no company is due for purge. | `lib/tenant-data.ts` ~582 | "a purge against the schema the migrations build finishes without errors…" |
| 64 | FIXED 17 Nov (was Med) | The purge's batched-delete fallback (for a big company that times out) can't run inside the cron: the fail-closed guard throws first, so a large company can never be purged. | `lib/tenant-data.ts` ~338–346 | "falls back to batched deletes when the one-statement delete times out…" |
| 65 | FIXED 17 Nov (was Low) | A purge that failed is still reported as purged, hiding it from the morning check. | `lib/tenant-data.ts` ~842–853 | "an org whose purge failed is not reported as purged" |
| 66 | FIXED 17 Nov (was Med) | A scheduled invoice that took a part prepayment is never auto-sent: the payment makes it part-paid, and auto-send only looks at drafts. The client never gets the bill for the balance (Svit's prepay flow). | `lib/invoice-send.ts` ~511, ~618 | `crons-invoice-email` "a scheduled draft that took a part prepayment is still sent to the client" |
| 67 | FIXED 17 Nov (was Med) | Auto-send skips a client with no email and never tells the owner, though the code promises an alert; the morning digest had listed it as going out. | `lib/invoice-send.ts` ~590–599 | "a client with no email: the draft is skipped and the owner is told…" |
| 68 | FIXED 17 Nov (was Low) | Two overdue-reminder runs at once both remind the same client (sends, then stamps). | `lib/automations.ts` ~1823–1884 | "two runs at the same moment remind each client once" |
| 69 | FIXED 17 Nov (was Med) | The in-app assistant refuses anyone active in two companies (you, for one: Svit plus the Velluma demo). | `api/ai-chat/route.ts` ~84–104 | `crons-assistant` "someone active in two companies can use the assistant" |
| 70 | FIXED 17 Nov (was Low) | A suspended workspace can still use the assistant (Sollos's Anthropic key). | same | "a member of a suspended workspace is refused" |
| 71 | FIXED 17 Nov (was Low) | Comped workspaces (billing override) are emailed that their trial is ending; paying subscribers can be too. | `api/cron/trial-expiring/route.ts` ~128, ~172–187 | `crons-digests-trials` (2 tests) |
| 72 | FIXED 17 Nov (was Low) | Trial reminders the email service refused are counted as sent. | same, ~85–91 | "a reminder Resend refused is not counted as sent" |
| 73 | FIXED 17 Nov (was Low) | An owner of two opted-in companies gets the weekly changelog twice. | `lib/product-changelog.ts` ~175–249 | "an owner of two opted-in companies gets one copy" |

### People: employees, hiring, training, time, bonuses, sign-in

| # | Sev | What's wrong | Where | Shown by |
|---|---|---|---|---|
| 74 | FIXED 17 Nov (was High) | Force-removing an employee deletes their whole login, which removes them from every other company they belong to. Another action already guards this case. | `employees/actions.ts` ~1096–1107 | `people-account` "force remove never reaches the same person's membership in another company" |
| 75 | FIXED 17 Nov (was Med) | The efficiency bonus compares each cleaner's minutes with the one-person estimate: two cleaners who each worked their half of a divided job are both paid for "saving" time. Overpays every team job. | `bonuses/actions.ts` ~236–276 | `people-time` "two cleaners who each worked their half of a divided job saved nothing" |
| 76 | FIXED 17 Nov (was Med) | A review bonus is skipped if efficiency bonuses were computed first for the same period (the "already awarded" check ignores the type). | `bonuses/actions.ts` ~78–87 | "…gets her review bonus even when efficiency was computed first" |
| 77 | FIXED 17 Nov (was Med) | Computing efficiency bonuses fails past about 320 finished jobs in the window (one over-long request). | `bonuses/actions.ts` ~207–213 | "a company with 400 finished jobs in the window still gets its efficiency bonuses" |
| 78 | FIXED 17 Nov (was Med) | Marking a new hire trained on an expiring module (WHMIS, first aid) sets no certificate expiry, so no reminder ever comes; the expiry trigger runs on update only. | `training/actions.ts` ~398, migration `20260420030000` ~80 | `people-hiring` "marking a new hire trained … dates her certificate…" |
| 79 | FIXED 17 Nov (was Med) | Replacing a training step's photo with one that's refused wipes the old photo and says saved. | `training/actions.ts` ~251–262 | "replacing a step's photo with one too big to keep leaves the old photo (or says no)" |
| 80 | FIXED 17 Nov (was Low) | A manager (Olha) opening a shift's history sees "no entries": the audit log is read through rules that only let owners and admins see it. | `timesheets/actions.ts` ~101–111 | `people-time` "a manager opening a shift's history sees its edits…" |
| 81 | FIXED 17 Nov (was Low) | An admin pressing "finish setup" saves nothing and is sent on as done. | `setup/actions.ts` ~12–21 | `people-account` "an admin finishing setup really finishes it" |
| 82 | FIXED 17 Nov (was Low) | Sign-in sends a cleaner to /app first (reads the whole company's memberships), and /app bounces them to /field. | `(marketing)/login/actions.ts` ~135–147 | "lands a cleaner on /field" |
| 83 | FIXED 17 Nov (was Low) | A certificate first seen inside 7 days gets the 7-day reminder, then a "30-day" one the next morning. | `lib/automations.ts` ~6230 | "a certificate first seen a week out is reminded once…" |
| 84 | FIXED 17 Nov (was Low) | Bonuses: a second "mark paid" re-stamps the paid date; marking, editing or deleting another company's bonus answers ok (and logs). | `bonuses/actions.ts` ~360–641 | `people-time` (3 tests) |
| 85 | FIXED 17 Nov (was Low) | Training: no role check on edit or delete (a cleaner is told "saved"), a delete that didn't happen is logged, and an edit aimed at another company's module can attach steps to it. | `training/actions.ts` ~209–327 | `people-hiring` (3 tests) |
| 86 | FIXED 17 Nov (was Low) | Timesheet manager actions ignore a manager's Timesheets switch. | `timesheets/actions.ts` | "a manager whose timesheets access is switched off can't…" |
| 87 | FIXED 17 Nov (was Low) | Applicant status and notes, and hiring-document edits, answer ok when they reached nothing; a hiring-doc delete that didn't happen is logged. | `applicants/actions.ts` ~119–153, `hiring/actions.ts` ~53–106 | `people-hiring` (3 tests) |

### Size (load suite on a real server, 16 Nov)

The load suite passed 15 of 17: every race test (two people at once on
payments, crews, claims, pay periods, auto-send) and the ten-times-Svit run of
the nightly jobs. The two failures are below.

| # | Sev | What's wrong | Where | Shown by |
|---|---|---|---|---|
| 89 | Med (not at Svit's size yet) | The Reports page reads its totals in one go, so past 1,000 rows they are silently short: invoices created in the period (already at twice Svit's size), paid invoices and the period's bookings (at ten times). Svit has 343 invoices in total today. Fix: add up in the database (one RPC) or read in pages. | `src/app/app/reports/page.tsx` | `test/load/pages.load.test.ts` and `cutoff.load.test.ts` (new cut-off reads) |
| 90 | Low (at ten times Svit) | Already-known cut-off reads at ten times Svit's size: the scheduling board's week (the one to fix first: it would leave jobs off without saying), the calendar's three months and client picker, the dashboard's week. Listed in `KNOWN_CUT_OFF`; the list may only shrink. | `test/load/pages.load.test.ts` ~226 | `KNOWN_CUT_OFF` |

### Test suite

| # | Sev | What's wrong | Where |
|---|---|---|---|
| 91 | Low | The cut-off load test runs the morning check, which is wired to Svit's company id; that company doesn't exist in the test database, so the check answers 500 and the test fails. Not an app fault: give the test a company with that id, or pass one in. | `test/load/cutoff.load.test.ts`, `lib/morning-check.ts` ~118 |
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
