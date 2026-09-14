export const body = `
Reports answers three questions for a date range: **what came in**, **what each job actually made**, and **how each cleaner is doing**. The range defaults to the last 90 days in your own calendar; change it with the From and To dates and **Update**. Owners and admins only.

## What came in

The cards along the top are the money view: **Paid revenue** (paid invoices, net of tips, minus refunds), **Tips kept** by the business, **Outstanding** (sent, overdue and partly paid invoices), bookings, completion rate, average rating, and new clients. **Revenue by month** buckets paid invoices by the month they were paid, with kept tips noted beside each month rather than inside it, so service revenue stays comparable.

## Job profitability

This is the section that says whether a job paid. Every **completed** booking in the window counts as a job. Its **revenue** is the booking's price; its **labor** is every shift clocked on it — each cleaner's minutes at the wage that was stamped on the shift when they clocked in. That is exactly the arithmetic payroll uses, so a job's cost here and its cost on the pay run never disagree. Tips are left out of both sides.

- **Margin** is revenue minus labor, with the percentage of revenue beside it.
- **Worked vs quoted** compares the hours clocked against the hours the bookings were scheduled for. More than about ten percent over turns amber.
- **Jobs with time** tells you how far to trust the margin. A job nobody clocked on shows its full price as margin, because no wage was recorded — if that number is well short of the job count, the fix is in the field app, not in the pricing.
- **Labor off the job** is clocked time that isn't tied to any booking — office hours, travel, a manual entry without a booking. It is real cost that no client is paying for, so it's shown on its own rather than hidden.
- Contractor bills dated in the window are noted underneath: they're cost too, but no single job carries them.

**By client** sorts best margin first. The client near the bottom with many jobs is the one whose price or scope needs a conversation. **By service** shows which kinds of work pay and which run long. **Jobs that hurt the most** lists the eight thinnest margins among jobs with clocked time, so you can open each booking and see why.

A job's price is the booking's **Total**, not the invoice — invoices can bundle several visits, and only the booking knows what one visit was worth. Bookings left at $0 will show as pure loss here, which is the report telling you to price them.

## Cleaners

One row per person who clocked time in the window, most hours first.

- **Hours** and **Jobs** are their own closed shifts. An open shift (still on the clock) isn't counted yet.
- **vs quote** compares their hours with their share of the scheduled time on those jobs. On a two-person job, each person is measured against their part of the quote, so nobody is penalised for sharing a job.
- **Pay** is what those hours cost at their wage — the same cents payroll pays.
- **Rev / hr** is the price of the jobs they worked, credited by their share of the time on site, divided by their hours. It's a productivity signal for you, never a commission: wages come from rates.
- **Rating** is the average of reviews that name them, with the count in brackets. **Bonuses** are those whose period ended in the window. **Flags** count bookings assigned to them that were flagged for no clock-in, and shifts still waiting on a needs-review check.

## Export

**Export CSV** carries everything on the page for the same range: the invoice and booking lists, then profitability by client and by service, then the cleaner table. If a list on screen is cut short, the CSV has the full set.
`;
