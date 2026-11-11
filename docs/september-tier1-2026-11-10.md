# September sweep, Tier 1 money list — re-verified 2026-11-10

Slice 9 of `finish-plan-2026-10-28.md`. The sweep on 2026-09-02 confirmed nine
money bugs and fixed none at the time. Each was re-checked against the code as
it stands, and against Svit's production data (read-only), on 2026-11-10.

| # | What it was | Verdict | Where |
| --- | --- | --- | --- |
| 1 | Stripe: the ledger insert's error was dropped after the webhook had claimed the event, so a card payment could exist at Stripe and nowhere here | **Closed** by the fail-closed scope on 2026-11-08 (`14fab63`), **hardened** today: the write reads its own error, and a duplicate from the paired event is treated as success | `src/lib/stripe-invoice-payment.ts` |
| 2 | Pay runs priced a missing rate as $0 and stamped the hours as paid | **Was open. Fixed today.** Time with no rate is left out, left unstamped and named in the run's notes | `src/lib/pay-rate.ts`, `payroll-run-create.ts`, `subcontractor-run.ts` |
| 3 | Editing an invoice to point at a different job left the old job stamped as billed | **Was open. Fixed today.** | `releaseJobsRemovedFromInvoice` in `src/lib/billed-bookings.ts` |
| 4 | Deleting an invoice line left its job stamped, so it could never be billed | **Was open. Fixed today**, same function | `src/lib/invoice-line-items.ts` |
| 5 | Bookings page read crew with one request for up to 1000 ids; past about 390 it failed, crew read as empty, and saving deleted the crew | **Fixed** before today: the read is chunked, and the crew save refuses if it cannot read the current crew | `src/app/app/bookings/page.tsx`, `chunked-in.ts` |
| 6 | Assigning crew "this and future" wiped who had accepted | **Fixed** before today (`withPriorLifecycle` on both paths) | `src/app/app/bookings/actions.ts` |
| 7 | Wall time to instant took the zone's offset at the wrong moment: an hour off for a few hours after each clock change | **Was open in the function. Fixed today.** Bookings were already safe (the database derives their instant from the stored wall time); timesheets, payments and reports used the function. "Book again" no longer picks a date at all | `src/lib/validators/common.ts` |
| 8 | Only `sent` invoices become overdue, so a part-paid invoice past due is never chased | **Still open, on purpose. Needs a decision.** See below | `src/lib/automations.ts` |
| 9 | A cleaner's pay page hid hours for as long as their pay run was a draft | **Was open. Fixed today.** | `src/app/field/pay/page.tsx` |

## What production showed

- **#2 was live.** Svit's draft employee run for 2026-10-16 to 10-31 contains a
  $0 line for 2 real hours, for a member with no pay rate ("Svitlana Pavliuk
  employee"). Finalizing that draft as it is marks those hours paid at
  nothing. **Delete that draft and prepare it again after this deploys**, or
  set the rate first. The fix does not rewrite a run that already exists.
  Three members have no rate: that one, the owner, and Olga Musnytska
  (manager, disabled).
- **#9 was live** for everyone in that same draft run.
- **#3/#4:** four jobs ($640.50) are stamped to an invoice that does not name
  them by link. That is not proof they are stuck: older invoices list jobs as
  typed text, and for those the stamp is the only record. They need a person:
  Carmen North 2026-04-20 (invoice overdue), 2026-05-12 and 2026-06-09 (both
  on drafts), Elena Sanche 2026-04-02 (invoice paid). The fix deliberately
  never clears a stamp it was not told about.
- **#8:** no part-paid invoice exists, and the overdue reminder is switched
  off for Svit. Nothing is being missed today.

## #8, the decision

A part-paid invoice past its due date gets no reminder, because reminders
only go to `overdue` and only `sent` becomes `overdue`. Two ways to close it:

1. Remind on the balance while leaving the status `partially_paid`. Needs the
   reminder email to state what is still owed, not the invoice total.
2. Flip part-paid invoices to `overdue` too. **Not safe as the code stands:**
   the auto-void writes off `overdue` invoices by age without looking at
   payments, so it would void an invoice somebody has partly paid.

Either one starts sending email to clients who get none today, so it is a
product call, not a bug fix to slip in. Option 1 is the one to build.

The second half of the original finding, "the pay page blocks refunded", is
how the page is meant to read: it tells the client the invoice was refunded
and that nothing is owed.

## Tests added

- `src/lib/pay-rate.test.ts`, `src/lib/subcontractor-run.test.ts`: no rate is
  not zero; a rate set to zero is still a rate.
- `src/lib/validators/local-input.test.ts`: every half hour of both
  clock-change days reads back as the time that was typed.
- `test/db/money.api.test.ts`, on the real database: the pay run, the invoice
  stamps (off a draft, off an issued invoice, never for a job it was not
  asked about, never another invoice's stamp), and the Stripe ledger write.
