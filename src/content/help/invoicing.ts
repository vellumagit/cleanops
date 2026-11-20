import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "invoicing",
  title: "Invoicing",
  blurb: "Creating invoices from jobs or by hand, line items, tax and discounts, sending, payments, voiding and deleting.",
  section: "Money",
  paths: ["/app/invoices", "/app/invoices/new", "/app/invoices/[id]", "/app/invoices/[id]/edit"],
  keywords: ["bill", "billing", "charge", "payment", "receipt", "invoice number", "overdue", "void", "refund", "discount", "tax", "GST", "HST", "mark paid"],
  body: `
Invoices in Sollos are built from bookings: the booking's **Total** is what lands on the invoice. Price a booking when you create it and invoicing is a couple of clicks; leave it at $0 and the $0 follows you here.

Owners and admins create, send, void and delete invoices and record payments. A manager who has been given **Invoices & estimates** access can see the invoice list and open invoices; without it, invoices are out of their app entirely.

## Where invoices come from

There are five ways an invoice gets made:

- **Automatically when a job is completed**, if the **Auto-draft invoice on job complete** automation is on (Settings → Invoicing, under Invoicing automations). Sollos makes a draft with one line describing the visit (service, date, time and address) at the booking's Total, adds your default tax, and sets the due date 14 days out. It skips jobs with no price, jobs with no client, and clients who are on a weekly, biweekly or monthly billing cycle (their work goes on one invoice per cycle instead; see [Billing cycles & recurring invoices](help:billing-cycles)).
- **Generate invoice** on a completed booking that has no invoice yet. Same draft as above, made on demand, even if the automation is off or the client is on a billing cycle. If the booking has no price you're warned that the draft will start at $0. Once an invoice exists, the booking links to it instead.
- **New invoice** on the Invoices page, for anything you want to write by hand.
- **Bill for a period**, which pulls one client's jobs from a date range onto a single invoice. See [Billing cycles & recurring invoices](help:billing-cycles).
- **Batch invoice** on the Invoices page. After you confirm, it makes a separate draft for every completed job that doesn't have an invoice yet. It is not a combined invoice: one job, one draft. It includes jobs priced at $0 and jobs for clients on a billing cycle, and it leaves alone any job whose invoice someone voided. Drafts it makes are not queued for auto-send.

A job can only be on one live invoice. Every path checks whether the job is already billed, whether by its own invoice or as a line on a combined one, and refuses rather than bill it twice.

## Writing an invoice by hand

1. Go to **Invoices → New invoice** (or **New invoice** from a client, which picks the client for you).
2. Choose the **Client**. If you came from a client with exactly one completed job that has no invoice, that job and its price are filled in for you. If they have several, an amber box lists them and offers **Bill them together**, which opens Bill for a period.
3. Optionally pick a **Linked booking**. The picker shows this client's bookings and is searchable by date or service. Bookings already on another invoice are greyed out and tagged *Invoiced*.
4. Add the money, either as line items or as a single amount (below).
5. Set a **Due date** if you want one, then **Create invoice**. You land on the new invoice, ready to send.

New invoices start as **Draft** unless you change the **Status** field.

### Line items

A new invoice opens with line items. Each row has a **Description**, **Qty** and **Unit price**; **Add line item** adds a row and the bin icon removes one. **Add discount** adds a discount row: type the amount off, or a percentage of the other lines and the amount follows it. Discounts come off before tax.

If you'd rather type one number, choose **Back to a single amount** (only offered before any items are saved). The single-amount form has a **Subtotal** box and an **Add tax to this invoice** switch. **Bill as itemized line items instead** switches the other way. Once an invoice has saved line items, it stays itemized, so billed jobs never lose their link to the invoice.

### Tax

Tick **Add tax** (or **Add tax to this invoice**) and enter the **Rate (%)** and a label such as GST or HST. Tax is worked out on the subtotal after discounts and shown to the client as its own line. A new invoice starts with your default rate from [Settings → Currency, tax & holidays](help:company-settings); editing an existing invoice keeps the rate it was saved with, so changing your default never re-prices old invoices. Rates and currency are set up under company settings.

There's one tax rate per invoice.

## Statuses

- **Draft**: not sent. The client can't be chased about it. Drafts sit under the **To send** tab.
- **Sent**: delivered (or marked sent). Under **Awaiting payment**.
- **Partially paid**: some money recorded, a balance left. Under **Awaiting payment**.
- **Overdue**: a sent invoice whose due date has passed with no payment. Sollos flips Sent to Overdue automatically each day. An invoice with no due date never becomes overdue.
- **Paid**: payments cover the total. Under **Paid**.
- **Refunded**: a card payment was refunded in full. Under **Paid**.
- **Void**: cancelled. Under **Void**.

Paid and partly paid are worked out from the payments recorded against the invoice, so you rarely set them yourself.

## Sending an invoice

On a draft, **Send invoice** emails the client straight away and the status changes to Sent. The email's subject is *Invoice [number] from [your business]*; it shows the invoice number, the amounts (with subtotal and tax lines when there's tax), the due date (or *On receipt* when there isn't one), a **View & Pay Invoice** button, a **Download PDF copy** link, and your contact details. A PDF copy is attached when it renders in time.

The send is done before the status changes: if the email can't go out, the invoice stays a draft and you see why under the button. The common reason is a client with no email address on file. Sending by hand is always by email.

On a sent invoice the button becomes **Send invoice again**, which asks you to confirm before delivering a second copy. It doesn't change the status or the sent date.

**View public link** opens the page the client sees, where they can pay by card if you've connected Stripe or Square. See [Getting paid online](help:getting-paid).

### Sending automatically

With auto-send turned on in [Settings → Invoicing](/app/settings/invoicing), drafts that Sollos makes itself are scheduled to send at the time you choose, and a blue note on the draft says when. Whatever the draft says at that moment is what goes out, so you can edit it until then, or press **Hold auto-send** to keep it back. Auto-send uses each client's billing preference: email, a text with the pay link, or both. Drafts you make by hand, or with **Generate invoice** or **Batch invoice**, aren't scheduled, with one exception: switching auto-send on queues every waiting draft from the last 7 days, whoever made it. The full set of rules is in [Billing cycles & recurring invoices](help:billing-cycles).

If auto-send couldn't deliver an invoice (no email, the client opted out, a $0 invoice), the Invoices page says so at the top and the invoice carries a **Needs manual delivery** tag; hover it, or open the invoice, for the reason.

## Overdue reminders

When the **Overdue invoice reminder** automation is on (Settings → Client automations), Sollos reminds the client once every 7 days while an invoice is overdue, by email and/or text according to their billing preference. A partly paid invoice that was sent and is past its due date is chased too, for the balance only, and a leftover under $1.00 isn't chased. Reminders stop on their own once the invoice is paid or voided. Clients set to **Do not contact**, or with **Billing** messages turned off, are never reminded.

A separate automation, **Auto-void long-overdue invoices**, voids unpaid invoices once they are a set time past due (1 year unless you change it in Settings → Automation thresholds) and emails owners and admins. It's off unless you turn it on.

## Recording a payment by hand

For e-transfers, cheques and cash, open the invoice and use the form under **Payments** (owners and admins). It only appears while there's a balance.

1. **Amount** is pre-filled with the balance; change it for a part payment.
2. Pick the **Method** (Bank transfer, Cash, Check, Card, and others).
3. **Received on** defaults to today. **Reference** is for a cheque number or confirmation code. Never type a full card number; it's refused.
4. If the client added a tip, open **Did they add a tip?** and enter it separately, choosing **We received it** (it goes onto Payroll's Tips to pass on) or **Paid straight to the cleaner**. The tip is never counted against the invoice.
5. **Record payment**.

The invoice moves to Partially paid or Paid by itself. When a payment completes the invoice and the **Receipt + review request on payment** automation is on, the client gets a receipt (by their billing preference) and a review request by email, once per invoice.

Manual payments can be corrected with the pencil (edit) or bin (remove) icons on the payment row. Card payments can't be edited, only refunded; see [Getting paid online](help:getting-paid).

Setting the **Status** to Paid on the edit form marks an invoice paid with no payment on it: no receipt goes out and the payment list stays empty. If payments are recorded, the edit form can't override them; the status is worked out from the money.

## Prepayments

If a client pays before the job is invoiced, record it on the booking under **Paid in advance**. It moves onto the job's invoice the moment one is made, however it's made, and the invoice shows as part paid or paid accordingly.

## Editing an invoice

**Edit** opens the same form. You can change anything on a draft or a sent invoice; the public link always shows the current version. Two things can't be edited: a **void** invoice and a **refunded** one. Both are closed records; create a new invoice instead.

The invoice page also shows an **Hours check** for invoices that bill jobs: each job's booked time beside what each cleaner clocked, flagged *Doesn't line up* when someone is more than 15 minutes off, or when a completed job has no hours at all.

## Void or delete

**Void invoice** (on the invoice page) or **Void selected** (tick invoices on the list) cancels an invoice but keeps it on record. The client isn't notified; if they open the link it says no payment is required.

**Delete invoice** is under Danger zone on the edit page and removes the invoice and its lines for good.

Both have the same guard: an invoice with money recorded on it can't be voided or deleted. Refund the card payment, or remove a mistyped manual payment, first.

What happens to the jobs:

- **Voided** invoice, or a **deleted invoice that had been sent**: its jobs are not billed again automatically, not by auto-drafting, Batch invoice or a billing cycle. If the work is still owed, bill it from the job's page or with Bill for a period.
- **Deleted draft**: the work is still owed, so the job is free to be billed again, and the next automatic run will pick it up.

There are no credit notes in Sollos. To bill less, edit the invoice (or add a discount line); to give money back, refund the payment.

## Finding things

The list opens on **To send**; the other tabs are **Awaiting payment**, **Paid**, **Void** and **All**. The search box takes invoice numbers (typing 149 finds INV-2026-0149), client names, dates ("Jul 6", "July 6" or "2026-07-06"), statuses ("overdue") and amounts ("183.75"). Words combine: "leslie july" narrows to that client's July invoices.

The list shows the newest 500 invoices and says so when there are older ones; search only looks inside what's shown. For one client's complete history, open their page and use **View all** beside Recent invoices. Old paid and voided invoices leave the list once the **Auto-archive old records** automation archives them; **Show archived** brings them back.

When a client has a company name on their profile, invoices, the PDF, the pay page and the invoice email are addressed to the company, with the person as *Attn*.

## Accounting sync (Sage, QuickBooks)

With Sage or QuickBooks connected under **Settings → Integrations**, an invoice is pushed to your books when it's sent, and payments recorded in Sollos (by hand or by card) follow it. A push that fails is retried every few hours, and the reason shows on the Integrations page. **Sync to Sage** and **Sync to QuickBooks** buttons on the invoice push it by hand. See [Integrations](help:integrations) for what each one posts.

## Common questions

**Why is this invoice still a draft?** Drafts only go out when you press **Send invoice**, or when auto-send is on and the draft was queued (a blue note on it says when). Drafts you write by hand and ones made with Generate invoice wait for you. If auto-send skipped it, the invoice says why.

**Why didn't my client get the email?** Most often the client has no email address on file; the error under **Send invoice** says so and the invoice stays a draft. If Sollos says the email was accepted, ask the client to check spam or promotions. **Send invoice again** re-sends it.

**Can I mark an invoice sent without emailing it?** Yes: set **Status** to Sent on the edit form. Nothing is emailed; it just records that the client has it (for example, you handed over a paper copy).

**How do I stop the overdue reminders for one client?** Turn off the **Billing** category in that client's notification settings, or set them to **Do not contact**. Turning off **Overdue invoice reminder** in Settings → Client automations stops them for everyone.

**I voided an invoice by mistake. How do I get the job billed again?** A voided invoice stays void. Open the job and use **Generate invoice**, or bill it with Bill for a period; automatic billing won't pick it up on its own.

**Why can't I delete or void this invoice?** It has payments recorded. Refund the card payment or remove the manual payment first, then void or delete.

**Can a client pay part of an invoice?** Yes. Record the amount you received; the invoice shows Partially paid with the balance, and the card pay link charges only the balance.

**Where do I change the invoice auto-send time?** [Settings → Invoicing](/app/settings/invoicing).
`,
};
