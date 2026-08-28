export const body = `
Automations are Sollos doing the remembering: confirmations, reminders, review asks, invoice sends, team alerts. There's a **fixed set** with on/off switches — no automation builder, no custom triggers, no editable email templates. You choose from the list; Sollos runs them on schedule.

## The switches

The client-journey switches live at **Settings → Client automations**; the machinery moved next to what it acts on — invoicing automations on **Settings → Invoicing**, the recurring-invoice switch on **Settings → Recurring invoices**, and payroll/timesheet automations (including the clock-out auto-cap thresholds) on **Settings → Payroll & timesheets**. One master switch on the Client automations page still governs all of them, wherever they live — flipping it off pauses everything, invoice auto-send included. Everything starts **off**. Two one-click presets get you going: **The essentials** (8 core automations) and **Full service** (19). Presets only ever turn things *on*; they never disable what you've chosen.

The page has two permanent sections:

- **Client automations** — every message a client can receive, in the order of their journey: winning the work (estimate follow-ups, expiry), when a job is booked (confirmations, reschedule notices, crew assignment), the day before (24h reminder), job done & getting paid (review ask, overdue reminders, receipts), growing the business (Google review asks, rebooking nudges).
- **Team alerts & housekeeping** — internal notifications and background bookkeeping that never reach a client: crew schedules, digests, training reminders, auto-complete and auto-archive timers. (Payroll, PTO, and invoicing machinery live on their own settings pages.)

## Who actually receives a client message

Turning a toggle on never spams anyone by itself. Every client message passes a chain:

1. The **org toggle** turns the message type on.
2. The **house default** (Default client notifications: email / text / both / none) sets the baseline.
3. The **client's own setting** wins over the house default — follow it, customize per category (booking / billing / reviews), or do-not-contact.
4. **Texts** additionally require the client's SMS opt-in (double opt-in; STOP always wins). No opt-in, no text — ever.

An org that wants nothing sent to unconfigured clients sets the house default to "No notifications" and opts clients in one by one.

## Asking rarely: the cadence knobs

Two automations have an **"At most"** cadence dropdown right beside their toggle, because asking too often is worse than not asking:

- **Internal review request** — after every clean (30-day minimum gap), 4× a year, 2× a year, or once a year, per client. A client who already left a review inside that window is never re-asked. Clients can always *volunteer* a review from their portal — every finished visit carries a link — so asking can be rare without reviews being rare.
- **Rebooking nudge** — same options. It only ever targets clients with no future booking, 14+ days after their last clean, and never someone whose last visit was over 6 months ago.

**Google review asks** are separate and even more restrained: one ask 48 hours after a client's *first* completed job, a reminder a week later, then monthly to a cap — and it stops the instant they click. Needs your Google review URL in Settings → Branding.

## Invoice auto-send lives elsewhere

Auto-sending drafted invoices is configured at **Settings → Invoicing**, not here: when on, a draft sends itself at your chosen local time (default 5:00 PM) the day *after* the job, by the client's billing channel. Every draft has Hold and Send-now escape hatches, and the **Morning invoice review digest** toggle (here, under Job done & getting paid) emails you each morning what's going out later that day.

## The fine print that keeps you safe

- **Settings → Thresholds** holds the housekeeping timers (auto-expire, auto-void, auto-complete, auto-archive). A blank field disables that timer.
- Marketing-style emails (rebooking nudges, Google asks) carry their own one-click unsubscribe — unsubscribing stops only those, never booking confirmations or invoices.
- Manual **Send** buttons always work, automation settings or not. Same for shift-offer texts: owner-clicked is always allowed.
- **Offer shift** on a booking texts a claim link to your own subcontractors (paid their usual rate) and the on-call pool (paid the flat amount on the offer) at once — first tap claims it.
`;
