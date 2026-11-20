import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "contractor-pay",
  title: "Paying subcontractors",
  blurb: "What each subcontractor and on-call cleaner is owed, pay statements, add-ons, recording payments and their invoices.",
  section: "Money",
  paths: [
    "/app/payroll/contractors",
    "/app/payroll/contractors/[contactId]",
    "/app/payroll/invoices",
    "/app/freelancers/payables",
    "/app/freelancers/payables/[contactId]",
  ],
  keywords: ["subcontractor", "contractor", "freelancer", "on-call", "bench", "1099", "T4A", "statement", "payout", "pay invoice", "reimbursement", "travel", "mileage", "owed", "outstanding"],
  body: `
Subcontractors are paid outside the employee payroll run, because the tax treatment differs. Sollos pays two kinds, and both live on one page, **Contractor pay** (Payroll → the **Contractors** card):

- **Your roster subcontractors**: people on Employees whose engagement is *subcontractor*. They earn **their rate times their clocked hours**, worked out exactly the way payroll prices a shift.
- **The on-call bench**: cleaners who claimed a shift offer. They earn the **flat amount on the offer** once the job is completed.

Owners and admins do everything here. A manager with **On-call pool & subcontractor pay** access can see what's owed but can't generate statements, mark them paid, record payments or upload invoices. Older links to the On-call pool's payables page bring you here.

## The Contractor pay page

**Outstanding** at the top is what you owe all subcontractors together. Below it are your **Pay statements**, then one row per person: **Jobs**, **Earned**, **Paid** and **Outstanding**, with a label saying *Your roster · paid on clocked hours* or *On-call · paid per claimed shift*.

How the numbers are worked out:

- **Earned** is, for a bench cleaner, the offer amount of every shift they claimed whose job is now completed. For a roster subcontractor it's their closed hours not yet on a statement, each at the rate stamped on the shift (or their current rate), plus any statements still marked *Owed*.
- **Paid** is the total of the payments you've recorded on their page.
- **Outstanding** is Earned minus Paid.

A statement you mark paid drops out of both Earned and Paid, so it settles the hours on it without a separate payment.

A **REVIEW** chip beside a name means they have capped shifts (nobody clocked out) that aren't counted in Earned yet. Confirm or correct them on [Timesheets](/app/timesheets) and they count.

## Pay statements

A statement freezes a period's roster hours into one total per person, like an employee run.

- **From Payroll**: preparing a pay period creates the contractor statement for the same dates alongside the employee run. See [Timesheets & payroll](help:timesheets-and-payroll).
- **From this page**: under **Pay statements**, set **From** and **To** and press **Generate**.

Either way, each roster subcontractor's unpaid closed hours that started in the period go on it, plus their add-ons dated in the period. A capped (REVIEW) shift in the period stops the statement until it's confirmed. A new statement shows as **Owed** and counts toward Outstanding. Each person's line has an invoice PDF listing every shift.

- **Mark paid** settles the whole statement once the money has gone out. Each subcontractor on it gets a notification that their statement was paid. Don't also record a separate payment for the same period, or you'll have paid it twice on paper.
- The bin icon deletes an unpaid statement; its hours go back to the floating balance and the period can be generated again. A paid statement is a record and can't be deleted.

With Sage connected, each statement posts a bill per person, and marking it paid records the supplier payment. **Post to Sage** appears on a statement Sage hasn't received.

Bench pay isn't on statements: it builds up per job on the person's balance and is settled by recording a payment. The pay period page lists the period's bench jobs and totals, with a link to each person.

## Add-ons: travel and reimbursements

On a pay period's page, **Add-ons** holds fixed amounts for a roster subcontractor on top of their hours. Press **Add**, then fill in:

- **For**: the subcontractor.
- **What for**: **Reimbursement**, **Travel** or **Other**.
- **Amount ($)**, up to $10,000.
- **Day**: within the period, and not in the future.
- **Note**: what it's for, such as *Parking at the Smith job*.

Add-ons go on the person's statement when the period is prepared, so add them **before** preparing. If the statement already exists, delete it, add the add-on, and prepare again. An add-on can be removed until a statement holds it. For employees, extra pay is a bonus instead.

## One subcontractor's page

Click a name to open their page: contact details, **Earned**, **Paid** and **Outstanding**, their **Statements**, their **Jobs** (for a bench cleaner, each completed claimed job and its pay; for a roster subcontractor, their hours are on Timesheets), **Payments** and **Invoices**.

### Recording a payment

**Record payment** (owners and admins):

1. **Amount**.
2. **Paid on**, which defaults to today.
3. **Method**: E-transfer, Cash, Cheque or Other.
4. **Reference**, such as a cheque number or e-transfer confirmation, and optional **Notes**.

The payment lowers their Outstanding straight away. A mistaken payment can be deleted from the Payments list. Sollos records payments; it doesn't move money.

### Their invoices

If a subcontractor sends you an invoice, keep it here with **Upload invoice**: a **File** (PDF or image, up to 15 MB), a **Label** (the file name if blank), the **Amount** and the **Invoice date**. Uploaded invoices are kept for your records and can be viewed or deleted; they don't change Earned or Outstanding. Reports counts the amounts of contractor invoices dated in its range as cost under Job profitability.

**Export CSV** downloads their statement: Earned, Paid and Outstanding, then their jobs and their payments.

## Pay invoices

[Pay invoices](/app/payroll/invoices) (**All pay invoices** on Payroll) lists one invoice per person per pay period, newest first, each with its PDF: employees from payroll runs and contractors from statements. Filter by **Person** and press **Show**; the line above the list totals what's paid and what's payable. Managers with subcontractor access see contractor invoices only. A draft run's invoices show here, but the person can't see theirs until the run is finalized.

## Common questions

**Why is this subcontractor's Earned lower than the hours they worked?** Capped shifts flagged REVIEW aren't counted until confirmed, hours with no pay rate aren't priced, and hours already on a paid statement have dropped out. Check Timesheets for the REVIEW chip.

**I marked a statement paid and also recorded a payment. Now they look overpaid.** Mark paid already settles the statement. Delete the extra payment from their Payments list.

**How do I pay a contractor for parking or travel?** Add it as an add-on on the pay period's page before you prepare the period, so it lands on their statement.

**How is an on-call cleaner paid?** The flat amount on the shift offer they claimed, once the job is completed. It adds to their balance here; record a payment when you pay them.

**Can a manager pay subcontractors?** A manager with **On-call pool & subcontractor pay** access can see balances and statements. Generating statements, marking them paid and recording payments are owner and admin actions.

**Where are the old payables pages?** Under the On-call pool they've moved here; old links redirect.
`,
};
