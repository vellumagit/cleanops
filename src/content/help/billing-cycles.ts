import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "billing-cycles",
  title: "Billing cycles & recurring invoices",
  blurb: "Billing a client weekly, biweekly or monthly, standing recurring invoices, Bill for a period, and the auto-send settings.",
  section: "Money",
  paths: [
    "/app/invoices/period",
    "/app/settings/invoicing",
    "/app/settings/recurring-invoices",
    "/app/settings/recurring-invoices/new",
    "/app/settings/recurring-invoices/[id]",
  ],
  keywords: ["monthly invoice", "billing day", "billing cadence", "retainer", "flat rate", "consolidated invoice", "statement", "auto-send", "send time", "recurring invoice", "subscription", "contract client", "invoice frequency"],
  body: `
Out of the box Sollos bills one invoice per job. For clients who'd rather get one bill a week, a fortnight or a month, there are three tools, and they're built not to overlap:

- **A billing cycle on the client**: Sollos gathers their completed jobs into one invoice each cycle, by itself.
- **A recurring invoice**: the same fixed amount on a schedule, whatever work was done. For contracts and retainers.
- **Bill for a period**: you pick a client and a date range and build the combined invoice yourself.

## Bill for a period

[Invoices → Bill for a period](/app/invoices/period) (owners and admins):

1. Pick the **Client**, a **From** and a **To** date, and press **Load bookings**.
2. Every job for that client in the range that isn't cancelled and isn't already on an invoice drops in as a line, priced at the booking's Total. Edit any description, quantity or amount, remove lines with the bin icon, or add your own lines.
3. Tick **Add tax** if the invoice should carry tax (it starts off here), and set a **Due date** if you want one.
4. **Create draft invoice**. You land on the new draft's edit page; send it from the invoice when it's right.

Dates are your own calendar days, so an evening job on the last day of the range is included.

**"Every job in this range already has a draft invoice."** This is normal when per-job drafts are being made as jobs finish. The amber box lists those drafts; tick the ones you want combined and each drops into the list as a line. When you create the combined invoice, the ticked drafts are voided so nothing is billed twice. You never need to delete a draft to make this work. Invoices the client already has (sent or paid) can't be folded in and are listed separately under *Cannot be folded in*.

Bill for a period is also how you bill a job whose invoice was voided: automatic billing leaves those alone, but this screen offers them.

## Billing cycles: one invoice per week, fortnight or month

Set this on the client's edit form under **Billing cadence**:

- **Invoice frequency**: **On demand — one invoice per job** (the default), **Weekly — every week**, **Biweekly — every two weeks** or **Monthly**.
- **Monthly billing day** (monthly only, 1 to 28): the cycle turns over on this day, so 15 bills the 15th through the 14th. Blank means calendar months, billed on the 1st for the month before.
- **Weekly / biweekly cycle start**: exact 7- or 14-day cycles counted from this date; the first invoice comes one full cycle after it. Weekly needs a date. Biweekly can be left blank for the fixed 1st-and-15th rhythm: the 1st bills the 16th to the end of the previous month, the 15th bills the 1st to the 14th.
- **Line-item style**: **Itemized — line item per booking** or **Flat rate — fixed retainer amount**, with the amount in **Flat rate (per period)**.

### What a cycle invoice contains

Early each morning Sollos checks every client on a cycle and, on their turnover day, makes one draft:

- **Itemized**: one line per completed job in the cycle, each at the booking's Total and described with its date, time and address.
- **Flat rate**: one line, *Retainer — [period]*, at the flat amount, with every job in the period (completed and cancelled) listed in the invoice notes. Leave the flat amount blank and it falls back to adding up the job totals.

Only **completed** jobs are billed. A job still pending or confirmed when the cycle closes is picked up by a later cycle once it's completed. The sweep also catches older completed jobs that were never billed, so switching a client onto a cycle can bring earlier unbilled work onto their first cycle invoice.

Every cycle invoice gets your default tax and a due date 14 days after it's made. If a client had no jobs in the period, no invoice is made, even on a flat rate.

Clients on a cycle don't get per-job drafts. **Generate invoice** on one of their jobs still works when you want one billed on its own; that job then stays off the cycle invoice.

> Monthly clients with a blank billing day, and biweekly clients on the 1st-and-15th rhythm, are cut off at midnight UTC rather than in your time zone, so a job late in the evening on the last day can land on the next invoice. Setting a billing day or a cycle start date measures the cycle in your own time zone.

## Recurring invoices

For a fixed amount billed on a schedule, use [Settings → Recurring invoices](/app/settings/recurring-invoices). Owners, admins, and managers with invoice access can create and edit them; deleting one is for owners and admins.

1. **New series**.
2. Give it a **Name** (for you, e.g. *Monthly retainer — Acme Corp*) and pick the **Client**.
3. **How often**: **Weekly**, **Every 2 weeks**, **Monthly** or **Quarterly**.
4. Add one row for each thing the invoice bills. Every invoice it makes carries these rows.
5. **Charge tax on these invoices** starts from your company's tax setting; untick it for no tax.
6. **First invoice date** (it's made overnight on that date) and **Net (days until due)**, 14 unless you change it.
7. Optional **Notes**, which appear on every invoice, then **Create series**.

Recurring invoices are only made when the **Auto-generate recurring invoices** automation is on; it's listed at the bottom of the same page. Each one is made as a draft, with your tax and due date, and is sent automatically only if auto-send is set up (below).

Monthly and quarterly series keep their day: a series on the 31st bills on the last day of shorter months and returns to the 31st after.

On the list, **Pause** stops a series and **Resume** starts it again from the next date that isn't already past, so a paused stretch isn't billed in a burst. **Due now** means a series' date has passed without an invoice, usually because the automation is off. If you then turn the automation on, it bills the missed dates one per night until it catches up; pause and resume the series first if you don't want those. Editing a series changes future invoices only.

## How the engines avoid double-billing

- A job is only ever on one live invoice. Every path, automatic or by hand, checks first.
- A billing cycle only picks up completed jobs that no invoice bills yet.
- A client with **both** a billing cycle and a recurring invoice: the recurring invoice is held for that period (no invoice is made) and owners, admins and managers get *Standing invoice held — client is on a billing cycle*. Keep one or the other.
- A per-job client with a recurring invoice **and** completed jobs nobody has billed: the recurring invoice is still made, and owners, admins and managers get *Standing invoice sent — unbilled jobs alongside it*, because only you know whether the fixed amount covers those jobs.
- Jobs whose invoice was voided, or whose sent invoice was deleted, are held out of every automatic run. Bill them from the job's page or with Bill for a period if they're still owed.

## Settings → Invoicing

[Settings → Invoicing](/app/settings/invoicing) is for owners and admins. It holds auto-send and the invoicing automations, including auto-void and the number of days it waits. Card tips are on Settings → Getting paid (see [Getting paid online](help:getting-paid)). There's no setting for invoice numbers or payment terms: numbers are assigned automatically in order (INV-2026-0149 style), per-job and cycle drafts are due in 14 days, recurring invoices use the series' Net days, and hand-made invoices use whatever due date you pick.

### Auto-send

**Auto-send invoices the day after the job** is off by default. Turned on, drafts Sollos makes by itself send at the time you choose, unless you edit or hold them first:

- **Send time**: the hour, in your business's time zone.
- **Send invoices** (per-job drafts): **The day after the job**; **After a set number of hours**, with **Hold for** 24, 48 or 72 hours, after which it goes at the next send time; or **On one day each week**, with a **Send day**, when everything drafted since the last send goes together (a draft made less than an hour before the send time waits for the following week). The page repeats your choice as a sentence: *Invoices go out every Friday at 5:00 PM*.
- **Also auto-send biweekly / monthly invoices**: when ticked, cycle invoices and recurring invoices are auto-sent too, always at the send time on the day after they're made. Untick it to review those by hand while per-job drafts still send.

Auto-send never sends a $0 invoice. Drafts you make by hand, or with Generate invoice or Batch invoice, aren't scheduled as they're made. It follows each client's billing preference (email, a text with the pay link, or both) and skips clients set to **Do not contact**. If a client can't be reached at all, owners and admins get an email saying so. The main automations switch on Settings → Client messages has to be on as well: turning it off stops all auto-sending.

Turning auto-send **on** queues your waiting drafts for the next send time: every unscheduled draft from the last 7 days with an amount (including ones you made by hand), plus every held draft, including drafts you held yourself. The confirmation says how many and when. Turning it **off** holds everything that was queued.

**Morning invoice review digest**, under Invoicing automations, emails owners and admins early each morning with yesterday's completed jobs and the invoices going out later that day, so you can fix or hold anything first. The other automations here are **Auto-draft invoice on job complete**, **Auto-void long-overdue invoices** and **Stripe payout notification**.

## Common questions

**My monthly client got no invoice this month. Why?** Their jobs in the cycle may not be marked completed yet (only completed jobs are billed), they may already be on another invoice, or a person voided their invoice and automatic billing is leaving them alone. Bill for a period shows which jobs in the range are already on an invoice.

**How do I bill a client once a month instead of after every clean?** Edit the client, set **Invoice frequency** to **Monthly**, and optionally a **Monthly billing day**. Per-job drafts stop for them and one invoice is made each cycle.

**Can I change which day a monthly client is billed?** Yes: **Monthly billing day** on their edit form, from 1 to 28.

**Will switching a client to monthly bill their old jobs too?** Any completed job of theirs that no invoice bills yet is swept onto the first cycle invoice. Check Bill for a period for that client first if you're not sure.

**Why didn't my recurring invoice go out?** It's made as a draft. It's only sent automatically when auto-send is on and **Also auto-send biweekly / monthly invoices** is ticked; otherwise send it from Invoices. If it wasn't made at all, check the **Auto-generate recurring invoices** automation, and whether the client is also on a billing cycle.

**I held an invoice, then saved Settings → Invoicing, and it went out. Why?** Saving with auto-send turned on re-queues every held draft for the next send time. Hold it again after saving, or send it yourself when it's ready.

**How do I stop invoices sending themselves?** Untick **Auto-send invoices the day after the job** and **Save**. Everything queued is held; drafts keep being made.
`,
};
