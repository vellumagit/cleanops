export const body = `
Time becomes money in three steps: **hours happen** (cleaners clock in and out), **Timesheets checks them**, and **a run pays them**. When a number looks wrong, find which step it's stuck in.

## Where rates live

On **Employees**, each person has an *engagement* (employee or subcontractor — which pay system they're in), a *pay type* (hourly for nearly everyone; flat per entry; percent of the booking's total), and their *rate*. The rate is stamped onto every entry at clock-in, so a raise never re-prices last month's hours.

> Pay never comes from what the client was charged. A job billed at $35/hr pays a $21/hr cleaner $21 — prices live on bookings, wages live on people.

## Where hours come from

Cleaners clock in and out on their job in the field app. A forgotten clock-out gets closed automatically past the job's expected end and flagged **needs review** — those hours wait for a human to confirm the real time before they count as pay. The office can also add manual entries on Timesheets and attach them to bookings.

## Timesheets, day to day

Opens on the current pay period; date filters reach anywhere. Each person shows hours and **Earned** (their rate × their minutes, computed live). Edit an entry to fix a time — edits are minute-exact, so a one-minute correction moves the total by exactly one minute. PTO lives here too: employee PTO carries paid hours; subcontractor time off blocks the schedule but is unpaid by design.

## Paying employees: Payroll runs

1. **Create a run** for the pay period — it starts as a *draft*.
2. **Review** each line (hours + bonuses). Fix entries on Timesheets, or delete the draft freely and start over.
3. **Finalize** — amounts lock and every hour in the run is *frozen*.
4. **Mark as paid** when the money has actually gone out. Sollos records; it doesn't move money.

An entry that refuses to be edited is frozen inside a run — that's the paid record protecting itself. The only unlock is deleting the run, which releases *all* its entries; fix and re-run.

## Paying contractors: statements

**Payroll → Contractor pay** covers two deals: roster subcontractors earn *their rate × their clocked hours*; on-call cleaners claimed from the bench earn the *flat amount on the offer* once the job completes. Statements total, stamp, and freeze exactly like runs. Flagged needs-review shifts are excluded from Earned until confirmed — the amber count links you to them.

> **Never pay straight from the CSV export.** It mixes employees and subcontractors with no column saying which is which. Employees get paid from runs; contractors from statements; the CSV is for bookkeeping.
`;
