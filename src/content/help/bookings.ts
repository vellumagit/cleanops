export const body = `
A booking is one visit: who, where, when, what kind of work, and what it costs. Everything else in Sollos — hours, invoices, checklists, the calendar — hangs off bookings, which is why a tidy booking habit keeps the whole system honest.

## Creating one

From **Bookings → New**, from an empty slot on the scheduler, from **+Book** on a client's profile (client, address, and their usual service/length/price arrive pre-filled from their last job), from **Create booking** on a request (date, address, notes, and service arrive pre-filled — and saving marks the request scheduled), or from **Book this job** on an estimate (client, price, and description carried over; the estimate shows "converted" once saved). A completed booking also has **Book again** — the same job duplicated onto the same weekday and time next week, landing on the edit page to adjust.

The fields that matter most:

- **Service** — what kind of work. Drives the calendar color, reports, and any checklist attached to that service.
- **Total** — what the client will be billed for this visit. *Price the job when you book it.* A $0 booking becomes a $0 invoice later, and those are the ones that end up as awkward client conversations.
- **Assigned to** — the cleaner(s). Everyone assigned gets notified and sees the job in their field app.

> Prices live on bookings; wages live on people. What you charge the client never touches what a cleaner earns — pay comes from each person's rate in Employees, applied to their clocked hours.

## Recurring

Tick **Repeats** and set the pattern; Sollos generates the visits ahead of time and keeps generating them. Editing a recurring booking asks whether you mean *just this visit* or *this and future* — the second rewrites the schedule from that date forward. A client skipping one week is a **skip**, not an edit.

The recurring list shows each series' **billing state**: an amber "N unbilled" chip means completed visits no invoice has claimed — click it to bill them. And the two recurring engines guard each other: if a client is on a billing cycle AND has a standing recurring invoice, the standing one is held with a warning instead of double-billing them.

When a save would **email the client** — the visit time moved, or the recurring schedule was rewritten — Sollos stops and asks: **Save & email client**, or **Save without emailing** (you tell them yourself). Saves that change nothing client-visible never email; a save with an untouched schedule doesn't touch future visits at all.

## Split shifts

A split shift is a hand-off: one cleaner does the first hours, another takes over — they don't overlap. For two cleaners working *together*, don't split; assign both as crew.

## Deleting and skipping

- **Skip** is for one visit of a recurring series that shouldn't happen — the series continues.
- **Delete** removes the booking. Past bookings can be deleted too (you'll get a firmer warning); hours logged on it are kept in Timesheets, just unlinked. A booking that's been invoiced refuses politely and tells you why.
`;
