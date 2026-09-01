export const body = `
Leads and clients are the same people at different moments — someone who *might* book, and someone who *has*. Sollos keeps them on one list under the hood but shows them on two pages, because you do different things to them.

## Leads

A lead is a name and what they want. They arrive three ways:

- **You type them in** — the quick-add row at the top of the Leads page: name, phone, email, and "what do they want?", always visible.
- **Your website sends them** — the estimate calculator and contact form create leads automatically (see *Website forms*).
- **They email or call** — you quick-add them during the call.

Editing a lead happens right on the Leads page — the **Edit** button opens a small dialog for their details and the note. Leads deliberately don't open the full client profile; they're not clients yet.

## Working a lead

Every lead row has **Quote** and **Book** buttons. Quote opens a new estimate with the lead selected and their "what do they want?" note already in the description; sending any estimate moves the lead to **Quoted** automatically. Book opens a prefilled booking — and creating any booking for a lead converts them to a client on the spot.

## Becoming a client

Two doors, both automatic in effect:

1. **Make client** — they said yes; press it and they move to the Clients page with everything carried over.
2. **Book them** — creating any booking for a lead converts them on the spot. Scheduling work *is* the yes, so nobody has to remember the button. This includes the automatic booking created when an estimate is approved.

Either way, any open website inquiries from them are resolved automatically — the Requests badge clears itself.

## Clients

A client's profile is the long-term record: address, standing notes (buzzer codes, pets), billing preferences, properties if they have several places, and their booking history. **+Book** from a profile starts a booking with the client, their address, AND their usual job — service, length, and price from their last booking — already filled. **New estimate** and **New invoice** start prefilled the same way, completed jobs in the history have a one-tap **book again**, and the stat cards ("Bookings 12", "Invoices 3") open those pages filtered to just this client.

> Same email = same person. If a website form arrives with an email you already have, it updates that lead instead of creating a duplicate. Different emails create separate leads — merge by hand if you spot twins.

## When a client leaves

**Archive them** — the button at the bottom of their profile, one move for everything: their upcoming bookings are cancelled (assigned cleaners are notified and calendar events removed), recurring schedules and standing invoices stop generating, their portal sign-in locks, and they disappear from every list, picker, and billing run. The confirm tells you exactly what it's about to cancel before you agree. What deliberately *stays*: their history, documents, and any **unpaid invoices** — archiving a client never archives a debt, so you can still chase and collect it. Archived clients live under the **Archived** toggle on the Clients page; **Restore** brings everything back (portal included) except the cancelled bookings and paused schedules — re-enable those on purpose if the client returns. Deleting is only for junk/duplicate entries with no history.

## Network

**Network** (under People) is the rolodex for everyone who matters but isn't a client and never will be: realtors who send you move-out cleans, property managers, suppliers, referral partners. Name, category, company, tap-to-call phone, and notes ("how we met, what they refer, their terms"). Deliberately separate from clients — no bookings, invoices, or portal hang off these people — and from the on-call pool, which is for workers you offer shifts to. If a network contact ever books a cleaning, add them as a client like anyone else.
`;
