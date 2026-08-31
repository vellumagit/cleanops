export const body = `
Time becomes money in three steps: **hours happen** (cleaners clock in and out), **Timesheets checks them**, and **a run pays them**. When a number looks wrong, find which step it's stuck in.

## Where rates live

On **Employees**, each person has an *engagement* (employee or subcontractor — which pay system they're in), a *pay type* (hourly for nearly everyone; flat per entry; percent of the booking's total), and their *rate*. The rate is stamped onto every entry at clock-in, so a raise never re-prices last month's hours.

> Pay never comes from what the client was charged. A job billed at $35/hr pays a $21/hr cleaner $21 — prices live on bookings, wages live on people.

## Where hours come from

Cleaners clock in and out on their job in the field app. A forgotten clock-out gets closed automatically past the job's expected end and flagged **needs review** — those hours wait for a human to confirm the real time before they count as pay. The office can also add manual entries on Timesheets and attach them to bookings — the booking picker is searchable (client, service, or date), and picking a booking fills the scheduled times in automatically; a **Use booking hours** button re-applies them after edits.

## Timesheets, day to day

Someone *still clocked in* shows in a calm **On the clock right now** card — status, not a problem. It only becomes a **forgotten clock-out** alarm once the shift runs well past its expected end.

Opens on the current pay period — the same calendar your pay schedule defines, with ‹ › arrows to step between periods; date filters still reach anywhere. Flagged rows are unmissable: amber-highlighted with a colored edge (capped shifts) or a lighter orange (ran past the allotted time), and the banner's **Show only these** button filters the table to just them. Any flagged row whose hours are simply right gets a one-tap **Looks good** button — no editor needed; it clears both kinds of flag, and saving an edit counts as review too. Each person shows hours and **Earned** (their rate × their minutes, computed live). Edit an entry to fix a time — edits are minute-exact, so a one-minute correction moves the total by exactly one minute. PTO lives here too: employee PTO carries paid hours; subcontractor time off blocks the schedule but is unpaid by design.

## Paying employees: Payroll runs

The Payroll page leads with one next step: an **Up next** card suggesting the next period, with the unpaid hours and estimated wages waiting in it — or, if a run is already in flight, a **Finish what's started** card pointing at it. Flagged shifts show as a warning there and are left out of the totals until confirmed.

Set a **pay schedule** (Settings → Payroll & timesheets) and periods follow your calendar — semi-monthly (1st–15th & 16th–end), every 2 weeks, weekly, or monthly. Setting a schedule also turns on the automation: the morning after a period ends, Sollos prepares it and notifies you it's ready for review. Nothing is ever paid automatically.

Preparing a period covers **everyone at once**: the employee run, the contractor statement, and the on-call bench's flat-pay jobs for the same window, shown together on the period's page with the combined total. A period contains **only its own dates** — older unpaid hours are settled by going back: the Payroll page lists **previous periods still owing** with a one-click Prepare on each. The **Pay periods** table at the bottom lists every period with employees and contractors side by side.

1. **Start this run** (dates are pre-filled; "Different dates?" if you need a custom window) — it starts as a *draft*.
2. **Review** each line (hours + bonuses). Fix entries on Timesheets, or delete the draft freely and start over.
3. **Finalize** — amounts lock and every hour in the run is *frozen*.
4. **Mark as paid** when the money has actually gone out. Sollos records; it doesn't move money.

An entry that refuses to be edited is frozen inside a run — that's the paid record protecting itself. The only unlock is deleting the run, which releases *all* its entries; fix and re-run.

## Paying contractors: statements

**Payroll → Contractor pay** covers two deals: roster subcontractors earn *their rate × their clocked hours*; on-call cleaners claimed from the bench earn the *flat amount on the offer* once the job completes. Statements total, stamp, and freeze exactly like runs. Flagged needs-review shifts are excluded from Earned until confirmed — the amber count links you to them.

> **Never pay straight from the CSV export.** It mixes employees and subcontractors with no column saying which is which. Employees get paid from runs; contractors from statements; the CSV is for bookkeeping.

## Tips to pass on

A tip a client adds at checkout (or that arrives by e-transfer or cash into the business) lands in the **business's** account, so Payroll keeps a ledger of what's still owed to each cleaner: the **Tips to pass on** card. Tips split across a crew by their minutes on the invoice's jobs. Two ways off the ledger:

- **Mark paid** — the money reached the person (through a run, in cash, however you actually pay). Records the handover; doesn't move money.
- **Keep in business** — the override. The tip was really meant for the business or the owner, nobody could be attributed, or it's a correction. It settles the tip *without* paying it out, asks you to confirm first, and shows on the invoice as *kept by the business* — distinct from paid out, so history stays honest. Owner/admin only. The same button on an invoice's tip box keeps everything unsettled on just that invoice.

A tip handed directly to the cleaner in cash never touches this ledger — record it as a *direct* tip and it appears in history already settled.

## Cleaners see their own pay

The field app has **My pay** (Profile → My pay, or from My hours): the current period's earnings as a running estimate from their closed shifts, and below it every finalized or paid statement — the same frozen numbers your runs produced, marked *Paid* or *Finalized — payment on the way*. The estimate is labeled as one: bonuses, PTO, and corrections land when you actually run the period, and shifts awaiting review say so. Draft runs you're still checking are never shown.
`;
