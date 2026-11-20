import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "integrations",
  title: "Integrations",
  blurb: "Connecting Stripe, Square, QuickBooks Online, Sage Accounting and Google Calendar — what each one syncs, which way, and how to disconnect.",
  section: "Settings & connections",
  paths: ["/app/settings/integrations"],
  keywords: ["connect", "stripe", "square", "quickbooks", "qbo", "sage", "google calendar", "gcal", "accounting", "bookkeeping", "card payments", "online payments", "sync", "disconnect"],
  body: `
**Settings → Integrations** connects Sollos to the services around it: a payment processor so clients can pay invoices by card, accounting software so your books fill themselves in, and Google Calendar so jobs show up where you already look. Owners and admins only.

Each card shows one of three states: **Connected**, **Not connected** (press **Connect** to start), or **Coming soon** (Sollos is still finishing that provider's app approval; it lights up by itself once approved).

If a connection stops working — a password change on the other side, access revoked, a token expired — a red banner at the top of the page says which one **stopped syncing**, when, and why, and the card goes back to **Not connected**. Connect it again to pick up where it left off.

## Payment processors: Stripe and Square

> **Sollos never holds your money.** When a client pays an invoice, the money moves straight from them to the processor account you connect.

**Stripe** — cards, Apple Pay, Google Pay and ACH. Press **Connect Stripe**, and Stripe walks you through setting up (or linking) your account. Back in Sollos the card shows your account, the date you connected, and whether **Charges** and **Payouts** are **Enabled** or **Pending**. If Stripe still needs something from you, the card says *Finish onboarding in Stripe to start accepting payments* and shows **Continue onboarding**; if it's still verifying you, it says so — that can take a few minutes to a few days. Clients can pay by card once charges are enabled.

**Square** — cards with next-day deposits; the natural choice if you already use Square in person. Press **Connect Square**, approve access in Square, and you return to the page with a confirmation.

What happens once a processor is connected:

- Your invoices get a card payment option on the page clients open to view and pay them.
- When a client pays, Sollos records the payment against the invoice automatically — including any tip they added, which is recorded separately from the invoice amount.
- If both are connected, clients pay through **Square**.

**Disconnect** stops card payments until you reconnect; Stripe asks you to confirm first. Payment instructions for clients who pay by e-transfer, cheque or Zelle are a separate setting — see [Getting paid](help:getting-paid).

## Accounting: QuickBooks Online and Sage Accounting

Both push your work **from Sollos into your books**, so your bookkeeper isn't typing invoices twice. Nothing flows back from the accounting software into Sollos.

### QuickBooks Online

Press **Connect QuickBooks Online** and choose the company in Intuit. Once connected, the card shows the **QuickBooks company** it writes to (its company ID, worth quoting to Intuit support) and when it was connected.

What syncs:

- **Invoices** — when an invoice is sent, it's created in QuickBooks, and the client is created as a customer if they aren't one yet.
- **Payments** — payments you record against a synced invoice, and card payments, are added to it in QuickBooks.

Each invoice page has a **Sync to QuickBooks** button (it reads **Synced to QuickBooks** once done) for pushing one by hand. Anything that failed is retried automatically every few hours. A problem retrying can't fix — a missing address, a tax rate QuickBooks doesn't have — shows on the card as **Last sync failed** with QuickBooks' reason; fix it and press **Sync to QuickBooks** on that invoice.

### Sage Accounting

Press **Connect Sage Accounting** and approve access in Sage. Sage needs two things from you before invoices go through, and the card asks for both:

- **Tax region** — Sage won't accept an invoice without one, and your tax rate has to exist in Sage for that region.
- **Account mapping** — which Sage accounts Sollos posts to: **Sales**, **Bank**, **Wages**, **Wages payable**, **Contractor costs**, **Tips owed**, **Tips kept**, **Card fees**. Sollos picks them by name the first time it posts; change any of them here. **Auto (pick by name)** lets Sollos choose again next time.

What syncs to Sage: invoices (with the client as a contact), payments, refunds, card processing fees, paid payroll runs (gross wages, one line per person), subcontractor bills and their payments, and tips — received, then paid out or kept. As with QuickBooks, each invoice has a **Sync to Sage** button, failures are retried automatically every few hours, and the card shows **Last sync failed** when something needs your attention.

## Google Calendar

Puts your jobs on a Google Calendar and keeps them there: events are created, moved and deleted as you add, reschedule and cancel bookings.

1. Press **Connect Google Calendar** and sign in with the Google account whose calendar you want — it doesn't have to match your Sollos login.
2. Upcoming bookings (from today on) are added straight away; new ones follow as you make them.

Each event is titled with the service and the client's name, and lists the crew and the booking's notes. Sync is one way: editing or deleting an event in Google doesn't change the booking. Fix it in Sollos and the calendar follows.

**Switch account** connects a different Google account instead. **Disconnect** removes the upcoming events Sollos created from the old calendar, so it isn't left with stale jobs. It only disconnects the company calendar — cleaners who connected their own calendars keep theirs.

**Cleaners' own calendars.** Each team member can connect their personal Google Calendar from their profile in the field app to see their assigned jobs there. That's their connection, not this card's. See [The field app](help:field-app).

## Asking for another integration

At the bottom of the page: *Want to see a specific integration here, or need help with webhooks?* Press **Reach out**, describe what you'd like to connect, and press **Send**. It goes to the Sollos team with your email so they can reply.

For connecting tools like Zapier, Make.com or n8n yourself, see [API keys, webhooks & intake forms](help:api-and-webhooks).

## Common questions

**A client paid by card. Do I need to mark the invoice paid?** No. With Stripe or Square connected, the payment is recorded against the invoice automatically when the processor confirms it.

**Stripe says Pending under Charges. What do I do?** Press **Continue onboarding** and finish what Stripe asks for. If you already have, Stripe is still verifying your account — that can take a few minutes to a few days.

**I have both Stripe and Square connected. Which one do clients use?** Square.

**Will invoices I make in QuickBooks or Sage show up in Sollos?** No. Sync goes one way, from Sollos into your accounting software.

**An invoice didn't appear in QuickBooks. How do I fix it?** Open the invoice and press **Sync to QuickBooks**; if it fails, the message gives QuickBooks' reason (often a missing address or tax rate). Sollos also retries failed invoices automatically every few hours.

**I moved a job in Google Calendar. Why did it jump back?** Sync goes from Sollos to Google. Move the booking in Sollos and the calendar event follows within a minute or two.

**Why does a card say Coming soon?** Sollos is still finishing that provider's app approval. The card switches to **Connect** by itself once it's approved.

**What happens to my Google Calendar when I disconnect?** Upcoming events Sollos created are removed from it, and bookings stop syncing. Reconnecting adds your upcoming bookings back.
`,
};
