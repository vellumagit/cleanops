import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "reports",
  title: "Reports",
  blurb: "What came in, what each job actually made, how each cleaner is doing, and how every number is worked out.",
  section: "Money",
  paths: ["/app/reports"],
  keywords: ["revenue", "profit", "stats", "analytics", "numbers", "margin", "income", "sales", "performance", "scorecard", "KPI"],
  body: `
Reports answers three questions for a date range: **what came in**, **what each job actually made**, and **how each cleaner is doing**. Owners and admins only.

The range defaults to the last 90 days in your own calendar; change **From** and **To** and press **Update**. Every date is read in your business's time zone, so an evening job or payment lands on the day you'd expect.

## What came in

The cards along the top:

- **Paid revenue**: the totals of invoices **issued in the range** that are now Paid, minus the totals of invoices issued in the range that were refunded in full. Invoice totals include any tax on them. Tips are never part of an invoice's total, so revenue is net of tips.
- **Tips kept**: tips you settled with **Keep in business** during the range. They're income that appears nowhere else, so they sit beside revenue rather than inside it.
- **Outstanding**: the full totals of invoices issued in the range that are Sent, Overdue or Partially paid. A partly paid invoice counts at its full total here, not just its balance.
- **Bookings**: every booking scheduled in the range, whatever its status.
- **Completion rate**: completed bookings divided by all bookings scheduled in the range. Cancelled and still-upcoming bookings count in the total, so a range that runs into the future reads lower.
- **Avg rating**: the average star rating of reviews submitted in the range, out of 5.
- **New clients**: clients (not leads) added in the range.

**Revenue by month** takes the same paid invoices and puts each in the month it was paid, with kept tips noted beside each month. **Service mix** counts the range's bookings by service. **Top clients by revenue** lists the five clients with the most paid, using invoices **paid** in the range. At the bottom, **Completed bookings**, **Cancelled bookings** and **Reviews received** give the plain counts.

Because Paid revenue goes by when an invoice was issued and Top clients by when it was paid, an invoice issued before the range and paid inside it shows in Top clients but not in Paid revenue.

If the range holds more than 5,000 invoices or bookings (or 2,000 reviews), a warning says the numbers are partial; narrow the range.

## Job profitability

This section says whether the work paid. Labor here is the same cents payroll pays.

- A **job** is every **completed** booking scheduled in the range.
- **Job revenue** is the sum of those bookings' **Total**, not their invoices: invoices can bundle several visits, and only the booking knows what one visit was priced at.
- **Labor** is every closed shift clocked on those jobs: each person's minutes at the rate stamped on the shift (or their current rate if it has none). Shifts still clocked in aren't counted.
- **Margin** is job revenue minus labor, with the percentage of revenue beside it.
- **Worked vs quoted** puts the hours everyone clocked on the jobs beside the jobs' booked hours. It turns amber when the work ran more than 10 percent over.
- **Jobs with time** is how many of the jobs had any time clocked. A job nobody clocked on shows its full price as margin, because no wage was recorded; when this falls well short of the job count, the fix is in the field app, not your pricing.
- **Labor off the job** is clocked time in the range that isn't tied to any booking: office hours, travel, a manual entry without a booking. It's real cost no client pays for, so it's shown on its own.
- **Contractor bills** dated in the range (the invoices subcontractors send you, uploaded on their pay page) are noted underneath as cost that no single job carries. Flat bench pay for claimed shifts isn't included in labor.

**By client** and **By service** break the same figures down, best margin first; the screen shows the top 12 rows of each and the CSV has them all. **Jobs that hurt the most** lists the eight jobs with the thinnest margin among jobs that had time clocked, so you can open each and see why. Tips are left out of both revenue and labor.

Bookings left at $0 show as pure loss here, which is the report telling you to price them.

## Cleaners

One row per person who clocked time in the range, most hours first. Subcontractors are marked as contractors.

- **Hours** and **Jobs** are their own closed shifts that started in the range, and the number of different bookings those shifts were on.
- **vs quote** compares their hours with their share of the booked hours on those jobs. Their share follows their share of the clocked time, so on a job two people split 60/40, each is measured against that part of the booked hours.
- **Pay** is what those hours cost at their wage, the same cents payroll pays.
- **Rev / hr** is the price of the jobs they worked, credited by their share of the clocked time, divided by their hours. It's a productivity signal for you, never a commission: wages come from rates.
- **Rating** is the average of reviews in the range that name them, with the count beside it.
- **Bonuses** are their bonuses whose period ends in the range.
- **Flags** counts bookings assigned to them in the range that were flagged for no clock-in, and their shifts still waiting on a REVIEW check.

## Export

**Export CSV** carries the same range: the invoice and booking lists, then profitability by client and by service, then the cleaner table. It holds up to 10,000 invoices and 10,000 bookings and says so at the top when it's cut short.

Currency follows your business's setting; see [Company settings](help:company-settings).

## Common questions

**Why doesn't Paid revenue match my bank deposits?** It counts invoices issued in the range that are now paid, at their full total including tax, and it doesn't subtract card fees. Deposits follow the date money arrived, net of fees, and can include tips.

**Why is a client missing from Top clients?** Top clients only counts invoices paid inside the range, and shows the top five.

**Why does a job show 100 percent margin?** Nobody clocked time on it, so it has no labor cost. Check **Jobs with time**.

**Why does a job show a loss?** Its booking was priced low or at $0, or the crew's time ran well over. **Jobs that hurt the most** links to each job so you can check.

**Does Reports include contractor pay?** Roster subcontractors' clocked hours are in Labor at their rate. Uploaded contractor invoices are noted as extra cost. Flat on-call pay isn't counted.

**Why is my completion rate low?** The rate divides completed bookings by every booking scheduled in the range, including cancelled ones and ones that haven't happened yet. End the range at today for a fairer figure.
`,
};
