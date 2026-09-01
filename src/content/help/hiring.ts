export const body = `
Hiring has its own lane in the sidebar, and its three pages map to the three moments of bringing someone on:

- **Applicants** — where website applications land, with a pipeline: new → reviewing → interview → hired → rejected. Each applicant carries their submitted details, resume link, and your notes.
- **Hiring** — the library you work FROM before the yes.
- **Training** — what a new employee works THROUGH after it: modules you author, assigned to people, completed in the field app. The Training page answers both directions: per module (who's done it) and per employee (the **By employee** list — who's fully trained, what's outstanding). An employee's file shows the same rollup for just that person, including certification expiry dates.

## The hiring library

Two kinds of documents, both edited the same dead-simple way (a title and one item per line):

- **Interview questionnaires** — open one during the call and work down the list. Same questions for every candidate makes comparing them honest. To keep the answers, run the interview from the applicant's page (below).
- **Hiring procedures** — the steps from yes to first shift: documents to collect (SIN, banking, signed contract), accounts to set up, pay rate to enter, training to assign. Written down once so hiring never depends on anyone's memory.

Each document expands in place to show its numbered items, and only owners and admins can edit the library.

## Recording interview answers

On an applicant's page, pick a questionnaire and hit **Start** — the questions are copied onto the applicant with an answer box under each, plus a notes field for everything off-script. Type as they talk, **Save answers** when done. Because the questions are copied in, editing the library questionnaire later never rewrites an interview you already ran; and a second round (phone screen, then in-person) is just another Start. Answers live on the applicant and follow them to the hire decision.

## The Hire button

When an applicant gets the yes, open their page and hit **Hire** — one dialog, nothing retyped. Their name and email come straight from the application; you add the two things only you know: how they're paid (employee via payroll, or subcontractor via statements) and their hourly wage. That sends the team invite, and the moment they accept it their account exists with the wage already applied — the first payroll run prices them correctly from day one. The applicant is stamped **hired** automatically. If the invite email can't be delivered, the dialog hands you the invite link to send yourself.

## Onboarding training assigns itself

Any published Training module can be marked **"Assign to every new hire automatically"** (a checkbox on the module). Those modules land on a new member's training list the instant they join — whether they came through the applicant pipeline or a plain invite from Employees. The "assign the onboarding training" line in your hiring procedure becomes the system's job, not memory's.

Every module also says **who it's for** — Employees & contractors, Managers, Admins & owners, in any combination. Each level only ever gets its own modules: a new manager receives the manager onboarding, not the bathroom SOP, and the module's roster page lists only the people it applies to (plus anyone who already carries an assignment, so history never vanishes).

## People added without a login

Someone can be added to the team manually (Employees → Add) with no account — they appear on schedules and timesheets but can't sign in. When they're ready for the field app, **send them an invitation using the same email on their record**: accepting it links the login to their existing record, so their hours and history come with them. It never creates a second person.

## When someone leaves

Set their status to **Disabled** on their edit page — nothing is deleted. Before you flip it, the edit page shows what deactivating would leave owed (unpaid hours, pending bonuses, tips, approved future time off); choosing Disabled also reveals an optional **reason for leaving**, saved admin-only on their file and cleared automatically on re-hire. On deactivation their sign-in stops working immediately, their upcoming jobs are unassigned (you're notified to re-cover them), an open clock is closed and flagged for review, and pending time-off requests are cancelled.

Afterwards their file shows a **Final settlement** card totalling everything still owed, with links to resolve each piece: unpaid hours are picked up by the next pay run automatically, but **pending bonuses and already-approved future time off are not** — pay or remove those yourself, and settle tips from Payroll. The file also carries a lifecycle line — applied → hired → joined → deactivated — with the dates. They move to the Archived tab on Employees. Re-hiring someone who had a login is flipping their status back to Active on their edit page (a fresh invite to that email is blocked and will point you there); update their role or wage on the same page while you're in it. Someone who never had a login re-joins through an invitation, which links and reactivates their old record.

You can't deactivate yourself, and the only active owner can't be deactivated — promote someone first.

## The seam between hiring and training

The line is the yes. Before it: questionnaires and procedures (this page). After it: the Hire button handles account, wage, and training in one motion; anything beyond that (contracts, banking details) lives in your hiring procedure checklist. If you find yourself writing "how we clean a bathroom" here, it belongs in Training; if you're writing "ask about weekend availability", it belongs here.
`;
