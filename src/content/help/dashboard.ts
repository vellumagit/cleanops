import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "dashboard",
  title: "The dashboard",
  blurb: "Today's figures, the Needs you list and its one-tap answers, snoozing, and the alerts it sends.",
  section: "Start here",
  paths: ["/app"],
  keywords: ["home", "today", "needs you", "needs attention", "overview", "revenue", "alerts", "no-show", "late", "not clocked in", "snooze", "kpi"],
  body: `
The dashboard is the first page of the office and the **Today** tab on a phone. It answers two questions: how is the business doing, and what needs a person right now. The second one is the **Needs you** list, and it's the part worth checking every morning.

Every "today" and "this week" here is counted in your company's time zone (**Settings → Timezone**).

## What's on it

- **The setup banner** — owners and admins see *Finish setting up your workspace* until setup is marked finished. A brand-new company with no clients opens straight onto the Get started checklist instead of the dashboard. See [Setting up your company](help:first-steps).
- **Today's revenue** (the first of four figure cards) — the total of today's jobs that are completed, with the number of jobs scheduled today underneath.
- **This week's jobs** — jobs in the last seven days (today included), with the change against the seven days before.
- **This week's revenue** — the same seven days, completed jobs only, with the change against the week before.
- **Outstanding invoices** — what clients still owe on sent invoices (a part-paid invoice counts only what's left), with how many are open and how many are overdue. The card turns amber when anything is overdue.
- **Needs you** — see below. It only appears when something is on it.
- **Today's jobs** — every job scheduled today in time order: client, time, the assigned cleaner (or *Unassigned*), status, and price. The heading opens Bookings.
- **Customer satisfaction** — your average star rating over the last 30 days and how many reviews it's based on.
- **Top-rated employees** — the five best average ratings over the last 30 days.
- **Recent activity** — the latest ten events: new bookings, reviews, and paid invoices. When a recurring series creates a batch of visits at once, they show as one line (*8 visits scheduled*) rather than eight.

On a phone the order changes so the day comes first: today's jobs and satisfaction, then Needs you, then the figure cards, then the rest.

A manager whose **Invoices & estimates** access is switched off sees two cards instead of four — **Today's jobs** and **This week's jobs** — and paid invoices are left out of Recent activity. See [Roles and permissions](help:roles-and-permissions).

## Needs you

**Needs you** lists every question your jobs are asking a person, each with its answers as buttons. A job that's going fine says nothing; a job that needs a decision gets one line here. When nothing needs you, the list isn't shown at all.

Owners, admins, and managers all see the same list. Live problems come first, then tomorrow's, then series times, then money. The bold title of each line opens the job (or Timesheets, or the series) if you'd rather look before answering.

### A job is finished but someone never showed

*Elena Park is finished on site* — the crew who came have finished, but someone rostered never clocked in. The line names who, and says when the job will close itself if you do nothing.

- **Close it** — marks the job completed now, the same as **Mark complete** on the job page. Anything your company has set to happen when a job completes happens then.
- **Still coming** — hides the line until the moment the job would close itself.

It isn't raised for a job that's still pending (unconfirmed), because a pending job can't be closed.

### Someone hasn't clocked in

*Maria hasn't clocked in* — a crew member who accepted the job still hasn't clocked in 30 minutes after their start. On a split shift, that's 30 minutes after *their* part starts. The line shows how late, and how many of the crew are already there.

- **Call** — rings their phone (shown when a phone number is on file).
- **Remove from job** — takes them off this visit after you confirm. Any hours they did log stay on the timesheet. If they were the job's lead, the next crew member takes that place.
- **Give it an hour** — hides the line for an hour.

When this line appears, the cleaner also gets their own message: the job has started, tap *I'm here* when you arrive, or tell your manager if you can't make it.

This check only runs for companies whose crews clock in — if nobody has clocked in during the last two weeks, silence isn't treated as news. It also skips crew whose acceptance is still pending and jobs that are still pending.

### Someone is still on the clock

*Maria is 1h 10m past her hours* — someone is still clocked in at least 15 minutes after their part of the job should have ended (their own share of the job's length, counted from when they clocked in or were due to start).

- **Clock out at 2:30 PM** — ends the shift at the time it should have ended, and marks the time entry for review on Timesheets.
- **Still working** — hides the line for an hour.

### Tomorrow's problems

*Tomorrow 9:00 AM · Elena Park* — a job tomorrow with something wrong while there's still time to fix it: nobody assigned, someone hasn't accepted, someone can't sign in (they have no login), someone is off tomorrow (approved time off or a day marked off), or no price. **Open job** takes you there.

### A visit needs cover

*Elena Park, Thu, Nov 26, 9:00 AM: needs cover* — a visit in the next seven days that someone was left off when the series' crew was set, because they're on another job at that time. **Open the visit** to pick someone else. See [Recurring series](help:recurring-series).

### A series' visits don't match its time

*Elena Park: 4 visits are an hour late, at 10:00 AM* — a recurring client's upcoming visits no longer match the series' time, and nobody set them by hand.

- **Restore to 9:00 AM** — moves those visits back to the series' time.
- **Make 10:00 AM the series' time** — keeps the visits where they are and changes the series, so visits it adds later come at 10:00 too. When the visits are at different times there's nothing single to adopt, so this reads **Keep these times** and simply stops asking.

Both ask you to confirm, and neither notifies the client or the crew. If restoring a visit would clash with another booking that cleaner already has at that time, that visit is left where it is and named, and the rest are restored.

### A finished job has no price

*Elena Park on Nov 12 is done but has no price* — a job completed in the last 45 days with no price that isn't marked free, so nothing was invoiced. **Set price** opens the booking's edit page; set the price, or tick Free if it was on the house.

## Snoozing

**Still coming**, **Give it an hour**, and **Still working** are snoozes. A snoozed line is hidden for everyone in the office, not just you, and comes back when the snooze ends if the problem is still there. The other lines have no snooze — they disappear when the problem is fixed.

## Alerts to your phone and email

You don't have to be looking at the dashboard. Sollos checks the list about every half hour, and the urgent lines — a job finished with someone missing, someone not clocked in, and someone an hour or more past their hours — are sent to every owner, admin, and manager the first time they appear: as a notification, a push to phones that allow it, and an email, each ending "Answer it on your dashboard." Each problem is sent once. If the job is rescheduled, it can be sent again for the new time.

At 6 PM in your company's time zone, if any of tomorrow's jobs have problems, the same people get one message listing them: *Tomorrow: 3 jobs need a look*.

When the alert is about a cleaner who is also told directly (the "hasn't clocked in" case), that person isn't sent the manager version about themselves. See [Notifications](help:notifications) for turning on push.

## Common questions

**Why don't I see Needs you?** It's only shown when something is on it. An empty dashboard below the figures is the good news.

**Someone was late and Needs you said nothing. Why?** It waits 30 minutes past their start (their own part's start on a split shift). It also stays quiet for crew who haven't accepted the job, for jobs still marked pending, and for companies where nobody has clocked in during the last two weeks.

**I snoozed a line and it came back.** Snoozes are short on purpose — an hour, or until the job would close itself. If the problem is still there when the snooze ends, the line returns.

**Does Close it send the invoice?** It marks the job completed, exactly like **Mark complete** on the job page. Whatever your company has set up to happen on completion (such as drafting an invoice) follows from that.

**Why doesn't Today's revenue match today's bookings?** It only counts jobs that are completed. Jobs still scheduled or in progress are in the count underneath but not in the money.

**Why does Sollos keep sending me to Get started?** A company with no clients that hasn't finished setup opens on the checklist. Add your first client, or press **Skip setup for now**.

**Can a manager see the money?** Only if their **Invoices & estimates** access is on. With it off, the revenue and outstanding-invoice cards are replaced by job counts.
`,
};
