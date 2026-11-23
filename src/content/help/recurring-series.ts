import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "recurring-series",
  title: "Recurring series",
  blurb: "Weekly, every-2-weeks and monthly cleans: setting one up, editing this visit or all future ones, skips, crew clashes, ending a series and billing.",
  section: "Scheduling & jobs",
  paths: ["/app/bookings/series"],
  keywords: ["recurring","repeat","weekly","biweekly","every two weeks","monthly","standing booking","regular client","series","skip a week","end recurring","stop recurring"],
  body: `
A recurring series is a standing schedule — "every second Tuesday at 9" — that Sollos turns into real visits on the calendar, ahead of time, and keeps topping up. Each visit is an ordinary booking you can change on its own; the series is the rule that makes the next ones.

Owners, admins and managers can create, edit and end series.

## Setting one up

From [Bookings → New](/app/bookings/new), switch the toggle at the top from **One-time** to **Recurring**. The date field gives way to a **Recurrence schedule**:

- **Frequency** — the pattern (the choices are listed below).
- **Time** — the start time of every visit.
- **Start date** — the first visit's date. A date in the past is allowed, for back-filling a client you've had for months.
- **Ends** — leave **Continue indefinitely** ticked, or untick it and pick an end date (the **1 year**, **2 years** and **5 years** buttons fill one in).

The frequencies:

- **Weekly** — every 7 days on the same weekday.
- **Every 2 weeks** and **Every 3 weeks**.
- **Every 4 weeks** — a pure 28-day cycle, 13 visits a year. Different from monthly, which follows the calendar.
- **Monthly (same date)** — e.g. the 15th, 12 a year; shifts by a day or two around shorter months.
- **Monthly (Nth weekday)** — e.g. the 2nd Tuesday. Pick **Which occurrence** (1st to 4th, or Last) and the **Weekday**.
- **Custom weekly** — several weekdays, e.g. an office cleaned Monday and Thursday. Tap the **Days of the week**.
- **Every 2 months**, **Every 3 months (quarterly)** and **Every 6 months** — same day of the month.

The rest of the form is the same as a one-time booking: client, duration, service, crew, and **Total**, which here is *per visit*. Two differences: there's no status (every visit is created Confirmed), and no per-person arrival times. Press **Create recurring booking**.

**Already booked a one-off?** Use **Make recurring** on its booking page, or **Make this recurring** on its edit page. Pick a frequency — Weekly, Every 2 weeks, Every 3 weeks, Every 4 weeks, or Monthly (same date) — and **Create series**. That visit stays as the first; the rest land on the same weekday and time.

## How far ahead visits appear

Creating a series from the New booking form makes its first 52 visits straight away — a year of weekly visits, two years of every-2-weeks. A series made with **Make recurring** starts with 8. Every night, any active series whose last visit is less than 30 days away gets its next batch of the same size. There's no cap: a series without an end date keeps going until you end it.

Dates on the series' skip list are never made, and an end date stops generation at that day.

## Who hears about a new series

- **The lead cleaner** gets one notification about the first visit (if **Notify employee on booking assignment** is on), not one per visit. The visits show in everyone's field app and on their connected Google Calendar.
- **The client** is not sent a booking confirmation when a series is created. If the 24-hour reminder automations are on, they get the usual reminder before each confirmed visit.

## Putting the crew on every visit

The crew you pick goes on every visit. Where someone already has another job at that time on a particular date, they are left off **that one visit** and everyone else stays on it (if they were leading it, the next person leads). The save doesn't refuse.

That visit is then marked **Needs cover**:

- a **Needs cover** chip on the bookings list and the schedule,
- a note on the visit's page naming who was left off and which job they're on instead,
- a line in **Needs you** on the dashboard for such visits in the next 7 days.

Right after the save, a banner on the bookings list (or, from **Change crew**, a message in the pop-up) says per person how many visits and which dates. Open each marked visit and pick someone else; the mark clears once that visit's crew is saved. Nobody is notified about, or put on the calendar for, a visit they were left off. The nightly top-up does the same when a new visit clashes.

This applies to a new series, an edit with **This and all future bookings** (including one that moves the series to another day, time or frequency), and **Change crew** with **This and all future bookings**. **Make recurring** still refuses on a clash and names the dates, and so does moving a series whose crew is on their own split times. A one-off booking with a clash is still refused.

## Editing: just this visit, or this and future

Open any visit and **Edit**. A banner says it's part of a recurring schedule, and **Apply changes to** asks:

- **Just this booking** — only this visit changes. Use it to move one clean, change one price, or swap the crew for one week.
- **This and all future bookings** — this visit and every later one get the change (price, crew, service, notes and so on). The button becomes **Save this & future bookings**.

Choosing *this and future* also opens **Edit recurring schedule**: **Frequency**, **Time**, **Regenerate from** (new visits are made from this date forward; it defaults to this visit's date) and **Series ends**. Changing the schedule removes the future pending and confirmed visits and makes them again from the new rule. Saving with the schedule untouched doesn't rebuild anything. Moving this visit to a different day with *this and future* moves the rest of the series to that day too.

When the change rewrites the client's upcoming visits, Sollos asks **Save & notify client** or **Save without notifying** before saving.

The **Change crew** pop-up (on the booking page, the list's **Change**, or the scheduler's **Assign**) asks the same question: **Just this booking** or **This and all future bookings**.

## Status for the whole series

Changing a recurring visit's status from the dropdown asks **This visit only** or **This and all future visits**. Up to 60 visits change at once; the message says if some were left as they were (a completed visit an invoice bills, for example) and, if it stopped short, which visit to open to carry on.

## Skipping a visit

- **You skip it**: open the visit's edit page and, in the Danger zone, press **Skip [date] only**. The visit is removed and the date added to the series' skip list, so it isn't made again; the series carries on. Only upcoming visits can be skipped (a past one has to be deleted instead), and nobody is messaged — tell the client and crew yourself if they need to know.
- **The client skips it** from their portal: 48 hours or more ahead, it's cancelled straight away and the office is told; closer in, it lands on [Requests](help:requests) for you to answer. A client's skip cancels the visit rather than removing it, and doesn't touch the series.

To skip with the standard notices (crew push, client cancellation notice), set that visit's status to **Cancelled** — choosing **This visit only**.

## Ending a series

On the **Recurring bookings** page, press **Cancel** on the series and confirm. Sollos:

- marks the series **Cancelled**, so no new visits are made,
- cancels every future pending or confirmed visit (past visits are kept),
- pushes a notice to the crew of each cancelled visit,
- sends the client **one** cancellation notice, about the nearest visit — by their channel preference, and only if the **Booking cancelled** email or text automation is on.

Alternatively, on a visit's edit page tick **Also remove the rest of the series** and **Delete this + future**: this visit and all later ones are deleted outright and the series stops, with no messages to anyone.

There is no pause and no restart button. To pause a client, cancel the series and create a new one when they come back, or set an end date.

## The Recurring bookings page

Reach it from **Recurring (N)** at the top of the bookings list (shown when you have at least one active series), or go straight to [Recurring bookings](/app/bookings/series). It lists your 100 most recent series with:

- **Client**, **Schedule**, **Service**, **Duration**, **Per visit**,
- **Billing** — an amber **N unbilled** chip counts completed visits no invoice has claimed yet; click it to start a new invoice for that client. **billed up** means none are waiting.
- **Bookings** — upcoming and total visits,
- **Period** — start date to end date, or "ongoing",
- **Status** — Active or Cancelled, with **Cancel** on active ones.

Search by client name at the top. If a client is on a billing cycle and also has a standing recurring invoice, the standing invoice is held with a warning rather than billing them twice; see [Billing cycles](help:billing-cycles).

## When visits drift from their series

Every visit remembers the time it was booked for, in your company's time zone, and Sollos keeps the exact moment matched to that time — so a change in clock rules can't quietly move a 9:00 visit to 10:00. If a recurring client's upcoming visits ever stop matching their series' time, **Needs you** on the dashboard asks about it: **Restore to 9:00 AM** puts them back at the series' time, and **Make 10:00 AM the series' time** keeps the visits where they are and moves the series to match, so later visits follow. When the visits disagree with each other, the second button reads **Keep these times**. Visits you moved by hand are left alone. Neither button messages anyone.

## Common questions

**How far ahead can I see a recurring client's visits?** A series made from the New booking form starts with 52 visits; after that, each night tops it up once the last visit is under 30 days away. A series made with Make recurring starts with 8.

**How do I change the time of every future visit?** Open the next visit, **Edit**, choose **This and all future bookings**, change **Time** under Edit recurring schedule, and save. Sollos asks whether to notify the client.

**The client is away for two weeks — what do I do?** Skip each date (**Skip [date] only** on the visit's edit page), or set each one to Cancelled with **This visit only** if you want the client and crew notified.

**How do I stop a recurring client?** **Cancel** on the Recurring bookings page. Future visits are cancelled, past ones kept, and the client gets one cancellation notice if those automations are on.

**Why is someone missing from some visits of the series?** They had another job at that time on those dates, so they were left off those visits only. Those visits show **Needs cover** until you pick someone else.

**Why didn't my client get a confirmation for the new series?** Creating a series doesn't send one. Tell them yourself, or rely on the 24-hour reminder if it's switched on.

**Can I pause a series?** Not as such — there's no pause button. Cancel it (or set an end date) and create a new series when they're ready to start again.
`,
};
