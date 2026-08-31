export const body = `
Invoices in Sollos are built from bookings — the booking's Total is what lands on the invoice. Price bookings when you create them and invoicing is a two-click affair; leave them at $0 and the $0 follows you here.

## One booking, one invoice

On a booking's page, **Generate invoice** creates a draft for that visit. If the booking is $0 you'll be warned before the draft exists. If an invoice already exists for the booking, the button is replaced by a link to it — number, amount, status — so duplicates can't happen by accident.

## Batch invoicing

For a client with several unbilled visits (or a company paying for several people), a **batch invoice** gathers bookings onto one invoice:

- Only unbilled work is offered. A booking already on a *sent* or *paid* invoice is locked to it.
- A booking sitting on an unsent **draft** can be folded into the batch — the old draft is voided automatically, on the logic that nobody has seen it yet.
- "Bill as company" puts the paying company's details on the invoice while the visits stay attached to the people who received them.

## The lifecycle

Draft → Sent → Paid, with Overdue when a due date passes. Payments recorded in the app (or arriving through Stripe/Square) mark the invoice paid and reconcile automatically. Refunds issued in-app do too.

## Finding things

The invoice number is the first column and it's searchable — a client says "about invoice 149", you type 149. The search box takes names, numbers, dates ("Jul 6", "July 6", or "2026-07-06"), statuses ("overdue"), and amounts ("183.75"). Words combine: "leslie july" narrows to that client's July invoices.

The list shows the newest 500 invoices and says so when older ones exist — search only looks inside what's loaded. For one client's complete history, open their page and use **View all** beside Recent invoices.

> A recurring client is usually better served by **period billing** — one invoice per month or cycle covering all visits — than by per-visit invoices. Ask about billing cadence on the client's profile.
`;
