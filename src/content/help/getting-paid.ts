import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "getting-paid",
  title: "Getting paid online",
  blurb: "Card payments through Stripe or Square, the client's pay page, payment instructions for e-transfer and cheque, tips and refunds.",
  section: "Money",
  paths: ["/app/settings/payment-methods"],
  keywords: ["pay online", "credit card", "card payment", "stripe", "square", "e-transfer", "etransfer", "interac", "cheque", "check", "payment link", "refund", "tip", "gratuity", "payout", "how do clients pay"],
  body: `
Every invoice has its own web page: the **View & Pay Invoice** button in the invoice email, the link in an invoice text, and **View public link** on the invoice all open it. That page shows what's owed and how to pay it: a **Pay with card** button if you've connected Stripe or Square, and your written payment instructions for e-transfer, cheque or cash.

## Connecting Stripe or Square

Owners and admins connect a card processor under [Settings → Integrations](/app/settings/integrations).

- **Stripe**: press **Connect Stripe** and sign in to (or create) your Stripe account. Until Stripe has finished checking your details the card says *Finish onboarding in Stripe to start accepting payments* or *Stripe is still verifying your account*, with **Continue onboarding**. The card shows whether **Charges** and **Payouts** are enabled. The Pay with card button appears on invoices once charges are enabled.
- **Square**: press **Connect Square** and approve the connection in Square.

Either can be removed with **Disconnect**; invoices then lose the card button until you reconnect.

If both are connected, the pay page uses **Square**. Client tipping only works through Stripe, so with both connected no tip is offered.

## What the client sees

The pay page carries your logo and colours and shows the **Amount due** (the balance still owing, after any payments and refunds), the due date, the invoice's lines, subtotal and tax, and any payments already received. Under **How to pay**:

- **Pay with card**, which takes them to Stripe's or Square's secure checkout and charges the balance.
- **Payment instructions**: your own text (below).
- **Tipping**: your tipping note, when tipping is turned on.

If you've neither connected a processor nor written instructions, the How to pay box doesn't appear at all.

A voided invoice says *This invoice has been voided. No payment is required.* A paid one says *Paid in full*. A fully refunded one says the money is on its way back.

After paying by card the client lands on a **Payment received** page. If they back out of checkout they return to the invoice and nothing is charged.

## When a card payment lands

All of this happens on its own, usually within seconds:

1. The payment is recorded on the invoice as a card payment, tagged with the processor (*via stripe* or *via square*).
2. The invoice becomes **Paid**, or **Partially paid** if the client paid less than the total.
3. If the **Receipt + review request on payment** automation is on and the invoice is now paid, the client gets a receipt (by email or text, by their billing preference) and a review request by email, once per invoice.
4. With Sage or QuickBooks connected, the payment is posted against the invoice in your books.
5. Any tip is recorded as owed to the cleaners on the job, split by the minutes each worked, and shows on Payroll under **Tips to pass on**. The tip is never counted as payment against the invoice.

The money itself goes to your own Stripe or Square account, less the processor's card fee (and, for Stripe, any application fee set on your account). The fee is recorded on each card payment. The **Stripe payout notification** automation, under Settings → Invoicing, emails owners when Stripe pays out to your bank.

A checkout link stays usable for a while after it's created, so a client can occasionally pay an invoice you've just voided. The payment is still recorded, the invoice stays void, and owners and admins are notified (*Payment on a voided invoice*) so you can refund it.

## A payment link to share yourself

With Stripe connected, an invoice that still has a balance shows **Send payment link**. Despite the name it doesn't send anything: it makes a Stripe checkout link and gives you **Copy payment link** (and **Preview**) so you can paste it into a message of your own.

## Refunding a card payment

Card payments are refunded from Sollos, on the invoice (owners and admins):

1. On the card payment's row, open **Refund…**.
2. Enter an amount, up to the part of the charge that paid the invoice, or tick **Refund everything on this charge** to return the lot. A full refund also returns any tip the client added and takes it off Tips to pass on, unless it was already paid out.
3. **Issue refund**.

The money comes back out of your processor balance and a refund can't be undone. The client usually sees it in 5 to 10 business days. A full refund marks the invoice **Refunded**. After a partial refund the invoice shows a balance again and its pay button charges just that remainder.

Manual payments (e-transfer, cash, cheque) aren't refunded through Sollos: you return the money yourself and remove or correct the payment on the invoice.

## Payment instructions (e-transfer, cheque, cash)

[Settings → Payment instructions](/app/settings/payment-methods) (owners and admins) holds the text clients see under **How to pay** on every invoice. Type what a client needs, for example your e-transfer email or where to mail a cheque, in **Default instructions** and press **Save instructions**.

This text is public: anyone with an invoice link can read it, so don't put anything there you wouldn't email to a stranger.

When the money arrives, record it on the invoice by hand; see [Invoicing](help:invoicing). Nothing connects to your bank account to spot e-transfers.

## Tips

Tipping is off until you turn it on in [Settings → Invoicing](/app/settings/invoicing), under **Tips**:

- **Let clients add a tip when they pay** adds a tip choice to the card checkout. **No tip** is always offered, and clients can pick **Other** to enter their own amount.
- **Suggested amounts** are percentages of the invoice balance; pick up to 4 from 5, 10, 15, 18, 20 and 25 percent.

Card tips need Stripe. For clients paying by e-transfer or cash, the **Tipping** box on Settings → Payment instructions holds a short note shown under your instructions, such as asking them to add the tip to their e-transfer. It only appears while tipping is turned on.

Tips collected land in your business's account along with the payment; Payroll keeps track of what you still owe each cleaner. See [Timesheets & payroll](help:timesheets-and-payroll).

## Common questions

**Why don't my invoices have a Pay with card button?** No processor is connected yet, or Stripe hasn't finished verifying your account (Settings → Integrations shows whether **Charges** are enabled). The button also disappears once an invoice is paid or voided.

**A client says they paid by card but the invoice still shows unpaid.** Card payments normally appear within seconds. If it's still unpaid, check the invoice's **Payments** list; a payment smaller than the total leaves it **Partially paid**. If nothing is there, contact Sollos through **Feedback** with the invoice number.

**Can I refund from my Stripe dashboard instead?** Refund from the invoice in Sollos: Stripe payments are taken through Sollos's platform, so the charge doesn't sit in your own dashboard to refund, and refunding here keeps the invoice, the tip ledger and your books in step.

**How do clients pay by e-transfer?** Write your e-transfer details in Settings → Payment instructions. They appear on every invoice's pay page. Record each payment on the invoice when it arrives.

**Do clients get a receipt?** Yes, when the **Receipt + review request on payment** automation is on and the payment covers the invoice. It goes by their billing preference.

**Why wasn't my client offered a tip?** Tipping is off, Stripe isn't connected, or Square is also connected (the pay page then uses Square, which has no tip option).
`,
};
