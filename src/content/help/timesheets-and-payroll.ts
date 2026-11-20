import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "timesheets-and-payroll",
  title: "Timesheets & payroll",
  blurb: "Hours to paid: rates, reviewing timesheets, pay periods, payroll runs, pay adjustments, tips and exports.",
  section: "Money",
  paths: ["/app/timesheets", "/app/payroll", "/app/payroll/[id]", "/app/payroll/periods/[range]", "/app/settings/payroll"],
  keywords: ["hours", "wages", "pay", "payroll", "pay cleaners", "cleaner pay", "paying staff", "clock", "salary", "pay run", "pay period", "pay schedule", "paycheque", "paycheck", "time sheet", "PTO", "time off", "overtime", "correction", "underpaid", "overpaid", "forgot to clock out"],
  body: `
Time becomes money in three steps: **hours happen** (cleaners clock in and out), **Timesheets checks them**, and **a pay period pays them**. When a number looks wrong, find which step it's stuck in.

Timesheets is open to owners, admins, and managers who have **Timesheets & time off** access. Payroll, pay periods and Settings → Payroll & timesheets are owners and admins only.

## Where rates live

On **Employees**, each person has an engagement (employee or subcontractor, which decides which pay system they're in) and an hourly pay rate. Everyone is paid by the hour; there's no flat or percentage pay for your own team. The rate is stamped onto every shift at clock-in, so a later change never quietly re-prices hours already worked.

> Pay never comes from what the client was charged. A job billed at $35 an hour pays a $21-an-hour cleaner $21: prices live on bookings, wages live on people.

### Changing a rate

When you change someone's rate, Sollos asks **When does the new rate start?**

- **From now**: shifts already worked keep the old rate.
- **From a date**: a past date re-prices that person's unpaid shifts from that day; shifts already in a pay period are never changed. A future date schedules the change, and the rate stays as it is until that day.

Lowering a rate has to be confirmed with a tick. Each change is listed under **Pay rate history** on the person's page. See [Employees](help:employees).

Paid time off is priced at the person's rate on the day the pay period is prepared, not the day of the time off.

## Where hours come from

Cleaners clock in and out on their jobs in the field app; time that isn't a job (a meeting, training, a supply run) is clocked from the field app's **Clock** tab under **Manager / admin**, **Training**, **Travel**, **Supplies / errand** or **Other**. All of it lands on Timesheets and in payroll the same way. See [Clocking in and pay in the field app](help:field-time-and-pay).

The office can add hours too, with **Log hours** on Timesheets (below).

## Timesheets, day to day

With a pay schedule set, Timesheets opens on the current pay period, with ‹ › arrows to step between periods. **From** and **To** (or the 7d, 14d, 30d and 90d buttons) reach any range. The cards at the top give **Total hours**, **Total earnings**, **Shifts** (one per person per job per day, however many times they clocked in and out) and **PTO hours**. **By employee** groups the rows per person; **All entries** lists every shift. Filter by **Employee**, or tick **Manual entries only**.

Each person shows their hours and **Earned**: their minutes at the rate stamped on each shift.

### Flagged shifts

Two kinds of shift are flagged, and a banner at the top counts them:

- **REVIEW** (amber): nobody clocked out, so the system closed the shift itself (see *Crew pay and booked hours*, below). These hours are the system's guess. **Payroll won't prepare a period while a REVIEW shift in it is unconfirmed.**
- **+time** (orange): the shift ran past the time allotted to that person on the job. Not necessarily wrong, just not yet confirmed. These don't block payroll.

**Show only these** filters the table to flagged rows. If a flagged row's hours are right, press **Looks good**: it clears both kinds of flag without changing the minutes. Otherwise open the entry and correct it; on a capped shift, **Use expected end** fills in when it was due to end. Saving an edit clears the flag too.

### Open shifts

Someone clocked in right now shows in a calm **On the clock right now** card, with **Clock [name] out** for a mistaken punch. Once a shift runs well past its expected end it moves to a **forgotten clock-out** card with **Close shift**, because an open shift has no hours to pay until it's closed.

### Logging hours by hand

**Log hours** back-fills a shift that wasn't clocked on the phone:

1. Pick the **Employee**.
2. Optionally pick a **Booking** (searchable by client, service or date). Leave it blank for non-job time such as office work, driving or quoting. **Use booking hours** fills in the job's scheduled times.
3. Enter **Start** and, if the shift is over, **End**. Neither can be in the future.
4. Add **Notes** if useful, then **Log hours**.

A manual entry is paid at the person's rate as it is when you log it. Sollos refuses an entry that overlaps another shift for the same person, one for an inactive employee, and one inside a period whose pay has already been prepared, because it would never be paid. If that period isn't paid yet, delete it, add the hours, and prepare it again; if it's paid, use a pay adjustment instead.

Opening an existing entry lets you change its times, **Change person or booking**, see **Show history** (who changed what, and when), or **Delete** it. Tick several rows and **Delete selected** removes them together.

### Entries that won't edit

Once a shift is in a prepared pay period, it's frozen. If the period isn't paid yet, the message links to it: delete the period, fix the shift, and prepare it again. If it's already **paid**, the hours can't change at all; add a **pay adjustment** instead (below). Shifts on a contractor statement work the same way, via the statement.

### Time off

Time-off requests appear on Timesheets with **Approve** and **Decline**; approved ones can be edited, cancelled (which frees the days on the schedule) or deleted. An employee's approved time off is paid at their rate; a subcontractor's blocks the schedule but is unpaid by design. Time off inside a period that's already been prepared isn't added to it: delete and re-prepare that period to include it. See [Availability & time off](help:availability-and-time-off).

### Export CSV

**Export CSV** downloads the shifts in view: employee, clock in and out, actual duration, client, service, scheduled time and length, arrival and completion, pay rate, earned, break minutes, clock-ins, and **Pay System**, which says *Payroll* or *Contractor statement* for each row. Pay employees from pay periods and contractors from their statements; the CSV is for your bookkeeping.

## Pay periods

Set the calendar in [Settings → Payroll & timesheets](/app/settings/payroll), under **Cadence**:

- **Manual — I'll pick dates each time**
- **Semi-monthly (1–15 & 16–end)**
- **Every 2 weeks** or **Weekly**, counted in exact 14- or 7-day steps from **A date a pay period started**
- **Monthly (calendar month)**

The schedule drives three things: Payroll suggests the last completed period, Timesheets opens on the current one, and (once a schedule is set) Sollos prepares each period the morning after it ends.

The same page lists the payroll automations: **Forgotten clock-out reminders** (with the grace period before a shift is capped), **Overtime warning**, **PTO request decision email**, **Payroll paid receipt** and **Divide team-job hours across the crew**.

## Running payroll

The Payroll page leads with one next step. If a period is already prepared but not paid, it's **Finish what's started**. Otherwise it's **Up next**: the suggested period, with **Unpaid hours**, **Wages waiting** (employees, before time off and bonuses) and **People** with unpaid time.

1. **Start this run** prepares the period. **Different dates?** lets you set your own **Period start** and **Period end** (up to 92 days), then **Create pay period**.
2. Preparing creates the **employee run** and the **contractor statement** for the same dates, side by side on the period's page, with the on-call bench's jobs from those dates. The employee run starts as a **draft**.
3. On the period page, **Review & finalize** opens the run: hours, regular pay, bonus, time off, any adjustment, and the total for each person, each with a **PDF** pay invoice. Fix anything wrong on Timesheets, or delete the draft and prepare again.
4. **Finalize** locks the amounts.
5. **Mark as paid** once the money has actually gone out. Sollos records pay; it doesn't move money.

A period contains **only its own dates**. Older unpaid hours aren't swept into today's period; the Payroll page lists **Previous periods still owing**, each with an estimate and a **Prepare** button, so old time is settled in the period it belongs to. The **Pay periods** table at the bottom lists every period with employees and contractors side by side; **All pay invoices** lists every person's pay invoice.

### What goes into an employee run

- Each active employee's closed, unpaid shifts that started in the period, at the rate stamped on the shift (or their current rate if the shift has none).
- Their pending bonuses whose period ends inside the pay period.
- Approved time off that overlaps the period.
- Any pay adjustments waiting for a period.

Hours for someone with no pay rate at all are left out and stay unpaid. Payroll warns you when anyone with hours in the period has no rate: set it on their employee file before preparing. If the period is already prepared, delete it (while unpaid) and prepare it again once the rate is set.

A run can't take anyone below zero: if adjustments would take back more than a person earned, Sollos says whose, and you lower or split the adjustment.

### Deleting a run

A **draft** run can be deleted freely. A **finalized** run asks you to type DELETE. A **paid** run is a permanent record and can't be deleted. Deleting releases its hours, bonuses, time off and adjustments to be paid by the next run that covers them.

### When you mark a run paid

Its bonuses are marked paid. With the **Payroll paid receipt** automation on, each employee gets an email receipt showing the amount, hours and the regular, bonus and time-off split. With Sage connected, the run is posted to your books (see *Payroll in the books*).

### Prepared for you

With a pay schedule set, the morning after a period ends Sollos prepares it and tells owners, admins and managers, in the app and by email: *Pay period ready for review*, with the total. If a REVIEW shift blocks it, the first morning's message is *Payroll is waiting on flagged shifts* instead, and Sollos tries again each morning. A period that's already prepared, or has nothing to pay, is left alone. Nothing is ever finalized or paid automatically.

## Pay adjustments

A paid period is locked for good, so a mistake found afterwards (a shift paid as 2 hours that was 4) is put right with a pay adjustment. On Payroll, under **Pay adjustments**, press **Add an adjustment**:

1. **Who**: an active employee.
2. **Amount**, and whether it **Pays them more (they were underpaid)** or **Takes it back (they were overpaid)**.
3. **What it corrects**: a short note, printed on their pay statement.
4. Optionally the **Period it corrects**, from and to.
5. **Save adjustment**.

It waits, marked *Waiting for the next pay period*, until the next period is prepared, and lands there as its own line. A period you've already prepared won't include it; delete that period (while unpaid) and prepare it again if it should. A waiting adjustment can be removed with its bin icon. Subcontractors are corrected through their contractor pay instead.

## Crew pay and booked hours

Pay is always each person's own clocked minutes times their rate. The booking's price never sets pay, and the booked length never cuts anyone's hours on its own.

Booked length matters in two places:

- **Forgotten clock-outs.** With **Forgotten clock-out reminders** on, a cleaner still clocked in past their job's expected end is reminded, then reminded again. The expected end is their own arrival window if they have one on the job, otherwise the job's full booked hours, counted from when they clocked in if they started late. Once your grace period runs out, the shift is closed at the expected end plus the grace period, flagged **REVIEW**, and managers are told. The hours are never silently settled: you confirm or correct them.
- **The +time flag** compares a shift with the time that person was allotted: their own segment of the job, or their share of the hours when the job's hours are divided across the crew.

**Divide team-job hours across the crew** only changes what cleaners see in the field app. It never changes the visit, pay or the client's bill.

## Contractors

Subcontractors and the on-call bench aren't paid in the employee run. Their hours go on a **contractor statement** for the same period, and bench jobs are paid at the flat amount on the offer. See [Paying subcontractors](help:contractor-pay).

## Tips to pass on

A tip a client adds at card checkout, or records as received by the business, lands in the **business's** account, so Payroll keeps a ledger of what's still owed to each cleaner: the **Tips to pass on** card. Tips are split across the crew by their minutes on the invoice's jobs. Two ways off the ledger:

- **Mark paid**: the money reached the person (through a run, in cash, however you pay). It records the handover; it doesn't move money.
- **Keep in business**: the tip was really meant for the business or the owner, or it's a correction. It settles the tip without paying it out, asks you to confirm, and shows on the invoice as *kept by the business*. Owners and admins only. The same button on an invoice's tip box settles every unsettled tip on that invoice. Kept tips show as **Tips kept** in Reports, beside revenue rather than inside it.

A tip handed straight to the cleaner in cash and recorded as **Paid straight to the cleaner** is settled from the start and never appears as owed.

## Payroll in the books

With **Sage Accounting** connected (Settings → Integrations), every employee run you **mark as paid** is posted to Sage as a journal of gross pay per person, against the wages accounts chosen on the Sage card. Each contractor becomes a supplier in Sage: a finalized statement posts a bill per person and marking it paid records the supplier payment. It's gross, not net: Sollos doesn't know deductions, so your bookkeeper clears the liability against your payroll product. A paid run that didn't post shows a **Post to Sage** button. See [Integrations](help:integrations).

## Cleaners see their own pay

The field app shows each cleaner a running estimate for the current period and every finalized or paid statement, using the same numbers as your runs. Draft runs are never shown to them. See [Clocking in and pay in the field app](help:field-time-and-pay).

## Common questions

**Why won't payroll run?** Most often a shift in the period is flagged **REVIEW** (nobody clocked out). Open Timesheets, press **Show only these**, and confirm or correct each one; then prepare again. Other reasons are shown in the error, such as nothing unpaid in the window.

**Someone forgot to clock out. What do I do?** If the shift is still open, use **Close shift** (or **Clock [name] out**) on Timesheets and give the real end time. If the system already capped it, it shows **REVIEW**: press **Looks good** if the time is right, or edit it.

**I paid someone wrong last period. How do I fix it?** Add a pay adjustment on Payroll for the difference, plus or minus, with a note. It goes on the next period you prepare.

**Why doesn't this shift show up in payroll?** Check that it's closed (has an end time), that it started inside the period's dates, that the person had a pay rate, and that it isn't on an earlier period already. Older unpaid hours are under **Previous periods still owing**.

**Can I undo a paid run?** No. Paid runs can't be deleted; use pay adjustments to correct what was paid.

**I gave a raise. Will last week's shifts get the new rate?** Only if you chose **From a date** and picked a date on or before those shifts, and they aren't in a prepared pay period yet.

**Why are the hours in the CSV different from the pay run?** The CSV covers whatever dates are in view on Timesheets; a run covers its period's unpaid shifts only, and leaves out shifts with no rate and shifts already paid.
`,
};
