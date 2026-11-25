import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "automations",
  title: "Automations",
  blurb: "Client messages and team alerts: every switch, what it sends, to whom and when — plus the master switch, presets, who receives client messages, and timing.",
  section: "Settings & connections",
  paths: ["/app/settings/automations", "/app/settings/team-alerts", "/app/settings/thresholds"],
  keywords: ["reminders", "automatic emails", "workflow", "auto", "master switch", "preset", "digest", "thresholds", "auto-complete", "auto-void", "auto-archive", "expire estimates", "overtime warning"],
  body: `
Automations are Sollos doing the remembering: confirmations, reminders, review asks, invoice drafts, team alerts, housekeeping. There's a **fixed set** of them, each with an on/off switch — no automation builder, no custom triggers, no editable email templates. You choose from the list; Sollos runs them on schedule.

**Everything starts off.** A new company sends nothing automatically until you turn on the master switch and the automations you want — so nobody gets emailed while you're still importing clients. The one exception is the email alert for new website leads (below). Automation settings are for **owners and admins**.

They live on two pages, plus a few beside what they act on:

- **Settings → Client messages** (under **Clients**) — everything a client hears from you, the presets, who receives client messages, and the master switch.
- **Settings → Team alerts & housekeeping** (under **Team**) — crew schedules, nudges to the office, digests, and the bookkeeping Sollos does for you.
- **Invoicing**, **Recurring invoices**, **Payroll & timesheets** and **Website & lead forms** each hold their own switches — see [Switches on other settings pages](help:automations#switches-on-other-settings-pages).

Both automation pages link to each other and to those pages at the top.

## The master switch

The banner at the top of both automation pages says **Automations are on** or **Automations are off**. It's one switch: flipping it on either page flips it everywhere.

- **Off** — nothing runs at all: no automated emails, texts, invoice drafts, reminders or housekeeping, wherever the switch lives. Invoice auto-send stops too, and drafts waiting to go out are held. Press **Turn automations on**.
- **On** — only the automations you've switched on run. **Turn all off** is your one-click "stop everything".

The master switch doesn't touch buttons you press yourself: sending an invoice or estimate, offering a shift, requesting SMS opt-in.

**Turning it back on starts fresh.** Nothing is saved up while it's off, so there's no pile of messages waiting. Reminders and schedules only look ahead, and review requests (ours and the Google one) leave alone any visit from before you switched on. What does carry over is money and housekeeping: invoice drafts that were held go out on their usual schedule, overdue reminders pick up their weekly rhythm, and past jobs are closed.

The master switch stops automations, not alerts about today's work. Someone who hasn't clocked in, a no-show to decide on, a shift left running: those still reach the office, because a business that's running needs them.

### Quiet mode

Below the master switch, **Quiet mode** stops everything the account would send: emails, texts and phone alerts, to clients and to your team, including the ones you send by hand. It's meant for a demo or test account between uses. Visits, invoices and the bell inside the app carry on as usual, so turning it off leaves nothing to catch up on. While it's on, a blue bar across the top of every page says so.

Don't turn it on for a business you run: nobody would be told anything, not even that someone hasn't shown up.

## Presets

Three starting points sit on **Settings → Client messages**. Presets only ever turn things **on** — they never switch off something you enabled — and each one also turns the master switch on. The larger ones reach beyond client messages: they also switch on invoice drafting and a few team alerts.

- **The essentials** (recommended) — booking confirmation, rescheduled and cancelled emails, the 24-hour reminder email, the push to an employee when they're assigned a job, auto-drafting an invoice when a job is completed, overdue invoice reminders, and the receipt on payment.
- **Full service** — the essentials plus estimate follow-ups, internal review requests, Google review requests, rebooking prompts, the weekly and monthly operations digests, employee daily and weekly schedules, auto-complete past bookings, and the unassigned booking alert.
- **I'll pick myself** — **Start empty** turns the master switch on and enables nothing; choose below.

On **Settings → Team alerts & housekeeping**, the *Team alerts & housekeeping* stage has **Turn all of these on**, which enables the internal set in one go — crew notifications and schedules, payroll and time-off emails, training reminders, review alerts, Stripe payout emails, digests, and the expire/archive/complete/recurring-invoice timers. None of them message a client. Auto-voiding invoices is deliberately left out; it changes money and deserves its own decision.

## How the pages are laid out

Each switch wears a badge saying who it touches:

- **Client message** — goes to your clients. Turning it on makes the message exist; the client's own settings decide who receives it.
- **Team alert** — goes to you or your staff. Clients never see these.
- **Background** — bookkeeping: drafts, status changes, archiving. Sends nothing to anyone.

The grey tag beside each switch says when it fires. Where it shows a clock time, that time is in UTC, not your local time.

Both pages group their switches into stages of a job's life (winning the work, when a job is booked, and so on). Client messages shows only client messages; Team alerts & housekeeping shows the team alerts and background switches. Each stage shows how many of its switches are on. Press a switch to flip it between **Enabled** and **Disabled**. Where a switch has a timing setting, it appears just under the switch once it's on — see [Timing settings](help:automations#timing-settings).

## Who actually receives a client message

Turning a switch on never spams anyone by itself. Every client message passes a chain:

1. The **switch** on this page turns the message type on (and the master switch must be on).
2. **Default client notifications** — your house rule: **Email only**, **Text only**, **Email + text**, or **No notifications**.
3. The **client's own settings** win over the house default. In the per-client manager under the client section (or on the client's page) you can set a client to follow the default, choose a channel per category — **Booking updates**, **Billing**, **Reviews & rebooking** — or mark them **Do not contact**. **Quick setup** offers **Everything**, **Essentials only**, **Nothing** and **Follow default**. Tick **Advanced automations** to mute individual messages for one client.
4. **Texts** additionally need texting turned on and the client's SMS opt-in (they replied YES; STOP always wins). No opt-in, no text — ever. See [Texting (SMS)](help:texting).

Review and rebooking messages are **email-only**: a client set to **Text** for that category gets nothing, and **Both** sends just the email. With **Text only** as your house default, review asks and rebooking nudges never reach clients who follow the default.

A company that wants nothing sent to unconfigured clients sets the house default to **No notifications** and switches clients on one by one.

**Do not contact** means Sollos doesn't message that client. It doesn't stop their account working: their jobs still auto-complete and their invoices are still drafted.

## Every switch on Client messages

**Winning the work**

- **Estimate follow-up** — emails the client a "still interested?" check-in 7 days after you sent an estimate that hasn't been approved or declined, and a "last chance" email at 14 days.

**When a job is booked**

- **Booking confirmation email** — to the client when a booking is created or confirmed for them.
- **Booking confirmation text** — the same by text: service, date and a contact number.
- **Booking rescheduled email** — to the client when a booking's time changes, showing the old and new slot.
- **Booking rescheduled text** — the new time by text. For clients opted in to texts this replaces the email — one notice, not both.
- **Booking cancelled email** — to the client when a booking is cancelled. (The assigned cleaner gets a push separately, so they don't turn up.)
- **Booking cancelled text** — by text; replaces the email for opted-in clients.

**The day before**

- **24-hour booking reminder to client** — email roughly 24 hours before the visit with the service, time and address. Once per booking.
- **24-hour booking reminder text** — sent alongside the email: the text gets noticed, the email carries the details.

**Job done & getting paid**

- **Overdue invoice reminder** — a polite reminder to the client every 7 days while an invoice is past due. Stops once it's paid.
- **Receipt + review request on payment** — a receipt and a review link when an invoice is marked paid.

**Growing the business**

- **Internal review request** — emails a review link (hosted by Sollos) after a completed booking, at most as often as its cadence (below). These reviews feed the dashboard rating, per-employee scores and bonus rules.
- **Google review request** — emails a link to your Google review page 48 hours after a client's *first* completed booking; if they haven't clicked, a reminder a week later, then monthly up to a cap. Stops the moment they click. Needs your Google Review link in **Settings → Branding**.
- **Rebooking prompt** — a "ready for your next clean?" email 14 or more days after a completed job, only when the client has nothing booked, at most as often as its cadence.

## Every switch on Team alerts & housekeeping

**Winning the work**

- **Draft a booking when an estimate is approved** — creates a *pending*, unassigned placeholder booking (tomorrow, 9 AM) linked to the estimate, so scheduling can't be forgotten. You still pick the real date, time and cleaner. Nothing is sent to the client for it.
- **Stale-estimate alert to you** — tells owners and admins (in the app, plus one push) when an estimate has sat in *Sent* for 7+ days with no decision.
- **Auto-expire stale estimates** — flips estimates in *Sent* with no activity to *Expired*. Set the number of days under the switch (default 30).

**When a job is booked**

- **Notify employee on booking assignment** — a push to the cleaner when a booking is assigned to them.
- **Job assignment text to employee** — the same by text, from your texting number.
- **Unassigned booking alert** — emails owners and admins when a booking within 24 hours still has no cleaner. Silent when everything is staffed.

**Job done & getting paid**

- **Shift still unconfirmed** — asks a cleaner to confirm a shift they haven't answered, the day before and again 2 hours before it starts; at the second nudge you're told too, so you can check or reassign.
- **Nobody clocked in yet** — nudges the assigned cleaner 15 minutes after start time if nobody has clocked in. Goes to the crew, not to you.
- **Job finished with no clock-in** — tells you 30 minutes after a job's expected end when someone was assigned but nobody clocked in at all, before auto-complete turns it into an invoice. Silent if your team doesn't use clock-in.
- **Auto-complete past bookings** — marks bookings still *Pending* or *Confirmed* as *Completed* once they're far enough in the past (default 24 hours; set under the switch).

**Team alerts & housekeeping**

- **Job starting soon push to employee** — a push to the assigned cleaner shortly before the job starts.
- **Employee daily schedule** — a morning email to each cleaner listing today's jobs: time, client, address, length and notes.
- **Employee weekly schedule** — a Sunday preview of each cleaner's week ahead.
- **Training assignment email** — to an employee when a training module is assigned, with a link to start.
- **Certification expiry reminder** — to an employee 30 and 7 days before a completed certification expires.
- **Notify admin on new review** — an in-app notification to owners and admins when a client leaves a review.
- **Low review alert** — emails owners and admins the full text of any review of 3 stars or less.
- **Weekly operations digest** — Monday email to owners and admins: last week's revenue, jobs completed and cancelled, average rating, overdue invoices, unassigned bookings ahead.
- **Monthly operations digest** — on the 1st: last month's revenue, job counts, rating, top clients, top performer, new clients.
- **Auto-archive old records** — hides finished bookings, invoices and estimates older than the age set under the switch (default 2 years) from the default lists. Nothing is deleted.
- **Show team feed** — shows the **Feed** in the office and field app. Off hides it.
- **Sollos product updates** — a short email about what's new in Sollos, at most weekly and only when there's news. Each owner can unsubscribe from their own copy.

## Switches on other settings pages

These are the same kind of switch, governed by the same master switch — they just live where their subject lives. When the master switch is off, each of these pages shows a banner saying nothing below runs.

**Settings → Invoicing**

- **Auto-draft invoice on job complete** — creates a draft invoice when a booking is marked completed.
- **Morning invoice review digest** — emails owners and admins each morning with yesterday's completed jobs and any invoices auto-sending later that day. Silent on quiet days.
- **Auto-void long-overdue invoices** — off means Sollos never voids anything by itself. On, it voids unpaid invoices once they're past due by the number of days set under the switch (default 1 year), logs each, emails owners and admins, and stops overdue reminders for them.
- **Stripe payout notification** — emails owners when Stripe sends a payout to your bank, with the amount and arrival date.

**Settings → Recurring invoices** — **Auto-generate recurring invoices** on the weekly, biweekly, monthly or quarterly schedules set up on that page. See [Billing cycles](help:billing-cycles).

**Settings → Payroll & timesheets** — see [Timesheets & payroll](help:timesheets-and-payroll):

- **Forgotten clock-out reminders** — reminds a cleaner still clocked in past the job's expected end, repeating at **Remind every**; at **Cap the shift & alert after**, the shift is capped, flagged for review and managers are notified, plus a text to the owner. Hours are never silently reduced — you confirm or correct the flagged shift.
- **Overtime warning** — a Friday email to any employee within 20% of the weekly hours set under the switch (default 40).
- **PTO request decision email** — to the employee when their time-off request is approved, declined or cancelled.
- **Payroll paid receipt** — to each employee when a payroll run is marked paid.
- **Divide team-job hours across the crew** — on a job with two or more cleaners, the field app shows each their share of the hours. Doesn't change the visit window, pay or the client's bill.

**Settings → Website & lead forms** — see [Website forms](help:website-forms):

- **Email me when a lead comes in** — every owner and admin, plus your contact email, get each website inquiry or estimate request. **On by default, and not paused by the master switch** — a missed lead costs more than a stray email.
- **Text me when a lead comes in** — the same as a short text to owners' and admins' profile phones and your contact phone. Needs texting on; counts toward your included texts.

## Asking rarely: the cadence knobs

Two automations have an **At most** dropdown beside their switch, because asking too often is worse than not asking:

- **Internal review request** — **After every clean (30-day minimum gap)**, **4× a year**, **2× a year**, or **Once a year**, per client. A client who already left a review inside that window isn't asked again. Clients can always *volunteer* a review from their portal — every finished visit has a link — so asking can be rare without reviews being rare.
- **Rebooking prompt** — **Monthly (30-day minimum gap)**, **4× a year**, **2× a year**, or **Once a year**. It only targets clients with no future booking, 14+ days after their last clean, and never someone whose last visit was more than 6 months ago.

**Google review requests** are separate and even more restrained: one ask after the first completed job, one reminder a week later, then monthly to a cap — and it stops the instant they click.

## Invoice auto-send lives elsewhere

Auto-sending drafted invoices is set up at [Settings → Invoicing](/app/settings/invoicing), not here: a send time, and a rhythm (the day after the job, after a set number of hours, or one day each week). It covers per-job invoices; clients on a weekly, biweekly or monthly billing cycle keep their own schedule. Every draft still has hold and send-now escape hatches. It obeys the master switch. Details in [Billing cycles](help:billing-cycles).

## Timing settings

Five automations have a number that sets their timing. Each one sits just under its own switch and appears once the switch is on. Change the number and press **Save** beside it. (These used to share a page called Automation thresholds; its old address now opens Team alerts & housekeeping.)

**Leaving a number blank turns that timer off** for your company even while the switch is on — except overtime, which always needs a number.

- **Auto-expire stale estimates** → **Expire after** *N* days with no answer. On Team alerts & housekeeping. Default 30.
- **Auto-complete past bookings** → **Mark completed** *N* hours after the scheduled time. On Team alerts & housekeeping. Default 24.
- **Auto-archive old records** → **Archive after** *N* days (at least 180). On Team alerts & housekeeping. Default 730 (2 years).
- **Auto-void long-overdue invoices** → **Void when** *N* days past due (at least 30). On Settings → Invoicing. Default 365.
- **Overtime warning** → **Overtime starts at** *N* hours a week; anyone within 20% of it gets the Friday email. On Settings → Payroll & timesheets. Default 40.

## The fine print that keeps you safe

- Marketing-style emails (rebooking prompts, Google review asks) carry their own one-click unsubscribe. Unsubscribing stops only those — never booking confirmations or invoices.
- Buttons you press yourself — sending an invoice or estimate, offering a shift ([Shift offers](help:shift-offers)), requesting SMS opt-in — work whatever the automation switches say.
- A $0 invoice is never auto-sent.

## Common questions

**I turned on the booking confirmation but my client didn't get it. Why?** Check the master switch is on, then the client: their own settings may say **Do not contact** or have booking updates off, your house default may be **No notifications**, or they have no email on file. The per-client manager shows a warning when a choice can't be delivered.

**How do I stop every automatic email at once?** Press **Turn all off** at the top of **Settings → Client messages** or **Settings → Team alerts & housekeeping** (it's the same switch). Everything stops — including invoice auto-send — except the new-lead email alert, which has its own switch on **Settings → Website & lead forms**.

**Does using a preset turn off what I already set up?** No. Presets only turn things on.

**Can I edit the wording of the emails?** No. The messages are a fixed set; your logo, brand colour and business name are applied to them from **Settings → Branding**.

**Why are the times on the page in UTC?** The tags show when each job runs on Sollos's clock. Emails that depend on "today" — like a cleaner's daily schedule — still use your company's time zone to decide which jobs to include.

**My bookings keep turning to Completed by themselves. Why?** **Auto-complete past bookings** is on. It completes *Pending* or *Confirmed* bookings 24 hours (or your threshold) after their scheduled time. Turn it off on **Settings → Team alerts & housekeeping**, or change the hours under its switch.

**Where did Automation thresholds go?** Each timing setting now sits under the switch it times — see [Timing settings](help:automations#timing-settings).

**What's the difference between Team alerts & housekeeping and What alerts you?** The switches on Team alerts & housekeeping decide whether Sollos sends an office alert at all, for the whole company. **What alerts you** (in your notifications) is each person's own choice of which of those reach their phone and email.

**How do I stop clients being asked for reviews so often?** Set the **At most** dropdown beside **Internal review request** to 4×, 2× or once a year.

**Where's the switch for the morning invoice digest?** On **Settings → Invoicing**, with the other invoicing automations.
`,
};
