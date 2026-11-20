import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "field-time-and-pay",
  title: "Clocking in, hours & pay (field app)",
  blurb: "How cleaners clock in and out on a job, take breaks, work without signal, clock non-job time, and check their own hours and pay. Also what happens when someone forgets to clock out.",
  section: "The field app",
  paths: ["/field/clock", "/field/hours", "/field/pay", "/field/shifts"],
  keywords: [
    "punch in",
    "punch out",
    "clock out",
    "time clock",
    "forgot to clock out",
    "break",
    "GPS",
    "location",
    "geofence",
    "offline",
    "no signal",
    "pay stub",
    "paystub",
    "statement",
    "wages",
    "my hours",
    "upcoming shifts",
  ],
  body: `
This guide covers how a cleaner's time gets recorded and what they can see of their hours and pay. In short: **on a job, the clock lives on the job screen.** The **Clock** tab is for time that isn't a job, and for a quick look at the day. Everything here is written so you can forward it to a cleaner.

## Clocking in on a job

1. Open the job from **Today**, or from the **Clock** tab's list headed **Today's jobs — open one to clock in**.
2. Tap **I'm here**. The clock starts, and the running time shows at the top of the job and on its card.

**I'm here** appears four hours before the job's start, not earlier. A job further out shows "This job is on" and its date instead, so nobody starts next month's visit by mistake. The shift has to be accepted first (see [Accepting a shift](help:field-app#accepting-a-shift)), and a cancelled job can't be clocked into.

Tapping a job card, or a job in the Clock tab's list, only opens the job. It never clocks anyone in.

## Breaks, supply runs and coming back

A cleaner can stop and start their clock on a job as often as the day needs:

- **Stop my clock — job stays open** (one tap) stops their clock for a break, a supply run, or a wrong tap. Their part of the job stays open.
- **I'm back — start my clock** starts it again.
- **Not coming back? I'm done here** (two taps) finishes their part from a break without clocking in again.

A job left on a break closes itself when its scheduled time is up.

## Finishing a job

**I'm done** takes two taps (**Tap again — I'm done**) because it stops their clock and says their part is finished.

- **On a solo job**, that completes the job: "Job complete. Nice work."
- **On a team job**, the job stays open until everyone who came has said they're done, or until its time is up and nobody else is coming. The screen says "You're done here. The job stays open until the rest of the crew is."
- **Tapped too early?** **Not done? I'm back** starts their clock again. It stays available all day on the job's date. On a job Sollos closed when the last clock stopped, clocking back in puts the job back in progress. On a job the office closed, the job stays closed but their time still counts.
- **Office closed the job while they're still working?** The screen says "The office closed this job. Your time still counts — stop your clock when you leave." Their clock keeps running until they stop it.

**I'm done** is refused on a job they never clocked into: "You haven't clocked in on this job yet. Tap I'm here first. If you forgot earlier, tap it now and tell your manager when you really started."

When a job completes, it's marked Completed. If your invoicing is set to draft invoices automatically, the invoice is drafted then (see [Invoicing](help:invoicing)).

## Two jobs in a row

Tapping **I'm here** on the next job while still clocked into the last one closes the last shift at that moment and counts as finishing it, so nobody is ever paid twice for the same minutes.

On the **Clock** tab, once the next job starts within 10 minutes, a **Done here? Start** button with that client's name appears. Two taps finish this job and clock into the next.

## Working without signal

Every tap records the time on the phone, not the time it reaches Sollos. With no connection, the tap is saved on the phone: "No signal. Saved on your phone with the time you tapped — it'll send when you're back in range." A banner shows how many taps are waiting. They send by themselves when signal comes back or the app is opened again, with the time the cleaner actually tapped.

A saved tap older than 12 hours can't be sent. The cleaner is told to give their manager the real time instead.

## Location

When a cleaner clocks in or out, the phone's location is recorded if the phone allows it. The phone asks permission the first time. If they say no, or the phone can't find a location within five seconds, the tap still goes through without one. Sollos doesn't block clocking in from somewhere other than the job.

In the office, **Timesheets** shows a small pin beside the clock-in time. It opens directions from where they clocked in to the job's address, which answers "were they on site?" at a glance. The **Clock** tab and the **Profile** page both tell cleaners their location is recorded at clock-in and out.

## The Clock tab

The top card says **On the clock** or **Off the clock**. When it's running, it shows how long ("3h 12m"), when it started with the weekday, and the client. Past ten hours it adds: "This shift has been running a long time — if you finished earlier, clock out and tell your manager the real time."

**Time that isn't a job** — a team meeting, training, a supply run — is clocked here:

1. Under **Not a job? Pick what this time is for**, choose **Travel**, **Supplies / errand**, **Training**, **Other** or **Manager / admin**. (Office users see **Manager / admin** first.) **Other** needs a few words about what it's for.
2. Tap **Clock in** (the button names the category, e.g. **Clock in — Travel**).
3. Tap **Clock out** when done.

This time is paid at the person's rate like any shift and lands on Timesheets with its category, so there's no need to book a fake job to pay for a meeting.

**While clocked into a job**, the Clock tab shows **I'm done**, **Just stop my clock — job stays open**, and **Open job for photos & checklist**.

Below the card, **Last 7 days** lists recent shifts (up to 20), with **All my hours →** for the rest. On phones that support it, the Sollos home-screen icon shows a badge with the hours on the clock.

## Forgetting to clock out

With **Forgotten clock-out reminders** on (**Settings → Payroll & timesheets**):

1. Once a cleaner is past their job's expected end, they get a "Still on the clock?" notification. It repeats every 30 minutes by default. The expected end is the scheduled end of their part of the job, or clock-in plus the job's length if they started late, so a late start still gets its full time. Time clocked without a job is allowed 12 hours.
2. Two hours past the end by default, the shift is capped at that point and flagged for review. Your managers are notified and the owner gets a text.
3. Nothing is quietly taken off. The flagged shift waits for a person to confirm or correct it, and it stays out of pay totals until then.

Both times are adjustable on that settings page: **Remind every** and **Cap the shift & alert after**. With the automation off, nothing reminds anyone or caps a shift that never stops.

**To fix it in the office:** open **Timesheets** (owners, admins, and managers with the Timesheets & time off permission). Flagged rows are highlighted. If the hours are right, tap **Looks good**. If not, edit the entry to the real time. The dashboard's **Needs you** list also flags someone still clocked in long after the end, with a button to clock them out at the right time. See [Timesheets & payroll](help:timesheets-and-payroll).

On the cleaner's side, a capped shift shows **Auto clocked-out** in **My hours**.

## My hours

Open it from **Profile → My hours** or the Clock tab's **All my hours →**. Pick **This week**, **Last week**, **30 days** or **90 days**. The top shows total hours, the number of shifts, and any still running. Below, shifts are grouped by day, each with the client (or the category for non-job time), start and end times, the service and the length.

Shifts that need attention are tagged **Auto clocked-out**, **Needs review**, or "45m over the job". These are the same numbers the office sees. When any are flagged, the page says so plainly: "Your hours haven't been changed — if something looks wrong, tell them what actually happened."

**Corrections:** cleaners can't edit their own hours or file a dispute in the app. They tell you, and you fix the entry on Timesheets or add a manual entry there.

## My pay

Open it from **Profile → My pay**, or **My pay →** on My hours.

- **This period** — an estimate of what they've earned so far. It's their closed shifts times the rate stamped on each shift at clock-in. It covers your current pay period if you've set a pay schedule in **Settings → Payroll & timesheets**, otherwise the **Last 14 days**. With no rate set, it shows hours only. It's labeled as an estimate: bonuses, time off and corrections land when you run payroll, and shifts waiting for review are called out because the total can still change.
- **Added by the office · on your next statement** — extra amounts such as travel or reimbursements that you've added and that aren't on a statement yet.
- **Statements** — every finalized or paid pay period: dates, hours, total, and what's included (bonus or time-off pay, an adjustment to earlier pay, travel or reimbursements). Each is marked **Paid** with the date, or **Finalized — payment on the way**. **Download invoice (PDF)** gives them their own copy with every shift listed.

Draft runs you're still checking are never shown. Until you finalize their first period, the page says "No pay statements yet." Sollos records pay; it doesn't move money. See [Timesheets & payroll](help:timesheets-and-payroll) and [Contractor pay](help:contractor-pay).

## Upcoming shifts

The **Shifts** tab lists assigned jobs on the days ahead. A banner counts those still waiting for an answer, and the highlighted cards open to the accept question. Jobs for today, and anything already started, are on **Today** instead. Shifts lists only work already assigned. Shifts you offer out arrive as a link (see [Shift offers](help:shift-offers)).

## Common questions

**My cleaner forgot to clock out. How do I fix it?** If the reminders automation is on, the shift was capped and flagged. Open **Timesheets**, find the highlighted row, and edit the clock-out to the real time, or tap **Looks good** if it's already right. If the shift is still running, the dashboard's **Needs you** list can clock them out at the right time.

**My cleaner forgot to clock in.** They can still tap **I'm here** when they remember. Then they tell you when they really started, and you correct the start on Timesheets. Until they clock in, **I'm done** is refused, because there's no shift to finish.

**Why does the job still say In progress after my cleaner left?** Usually they tapped **Stop my clock** (a break) instead of **I'm done**. The job then stays open until its scheduled time is up. On a team job, it stays open until everyone who came is done.

**Does Sollos stop someone clocking in away from the job?** No. It records where they were, if the phone allows it, and Timesheets lets you check the distance to the job. It doesn't block the tap.

**Why does My pay show hours but no dollar amount?** No pay rate is set for that person. Set one on **Employees**. Shifts clocked from then on carry it.

**Why doesn't My pay match what I paid?** The top figure is an estimate from closed shifts at their rate. Bonuses, time off and corrections only land when you run the period. The statements below it are the real, frozen numbers.

**Can a cleaner change their own hours?** No. They can see every shift and its flags in **My hours**, but changes are made by you on Timesheets.

**My cleaner tapped I'm here with no signal. Did it count?** Yes, if it sent within 12 hours. The phone keeps it and sends it with the time they tapped once there's a connection. A banner shows while anything is waiting.
`,
};
