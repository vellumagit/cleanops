import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "employees",
  title: "Employees & team members",
  blurb: "Adding people with or without a login, employee vs subcontractor, pay rates, the employee file, and what happens when someone leaves.",
  section: "Your team",
  paths: ["/app/employees", "/app/employees/[id]", "/app/employees/[id]/edit", "/app/settings/members"],
  keywords: ["cleaner", "staff", "crew", "worker", "team", "invite", "add employee", "wage", "pay rate", "fire", "terminate", "deactivate", "offboard", "rehire", "subcontractor", "contractor", "login", "password reset", "last day", "last working day", "notice", "leaving", "quitting"],
  body: `
**Employees** is your roster: everyone who works for you, from cleaners to office staff. Each person has a role (what they can open), an engagement (how they're paid), and an hourly pay rate. Owners and admins manage it; it sits under **People** in the sidebar.

## The team list

The list shows each person's name, phone, role, engagement, status, the date they joined, and their pay rate. Pay rates are confidential: only owners and admins see that column. Click a row to open that person's file.

A **Manual** tag next to a name means the person was added without a login (see below). Once anyone has been deactivated, two tabs appear: **Team** for the people working now, and **Archived** for people who have left. Nothing in Archived is deleted.

## Adding someone

There are two buttons at the top of the page, and the difference is whether the person gets a login.

- **Invite** sends an email invitation. When they accept, they have their own Sollos account: cleaners use the field app on their phone, office staff use the office.
- **Add manually** puts someone on the roster with no login at all. Use it for a family member helping out, a sub who'll never open the app, or anyone you just want on schedules and payroll.

Both count toward your plan's cleaner limit when the role is Employee. If you're at the limit, Sollos says so and points you to **Settings → Billing**, or to deactivating a cleaner or cancelling an invite first.

### Inviting someone

1. Click **Invite**.
2. Fill in **Full name**, **Email address**, **Role**, **Engagement**, and optionally **Pay rate**.
3. Click **Send invitation**.

The email goes out right away, and the dialog shows the invite link as well. If the email couldn't be delivered, the dialog says why and you can copy the link and text it to them yourself. The link expires in 14 days.

Open invitations wait in a **Pending invitations** panel at the top of the Employees page, each with a copy-link button and an **X** to revoke it.

When the person opens the invite, a new person creates an account (their name, their email, and a password of at least 8 characters). Someone who already has a Sollos login, for example because they also work for another company on Sollos, is asked to sign in with it instead. The invite only works for the email it was sent to: signed in as someone else, they're told to sign out and open the link again. The role, engagement and pay rate you chose are applied the moment they accept, and any training marked for new hires is assigned (see [Training](help:training)). Cleaners land in the field app; managers, admins and owners land in the office.

### Adding someone manually

Click **Add manually** and fill in **Name**, **Role**, **Engagement**, **Pay rate**, and optionally **Email** and **Phone**, then **Add employee**. They can be assigned to jobs and appear on timesheets and payroll, but they can never sign in, and nobody can send them a chat message.

**Giving a manual person a login later:** send them an invitation using the same email that's on their record. Accepting it links the login to the existing record, so their hours and history come with them; it never creates a second person. That's why the email on a manual record is worth keeping accurate.

## Employee or subcontractor

**Engagement** decides which pay system a person is in. It's one or the other, never both:

- **Employee** — paid through payroll. Accrues time off and overtime.
- **Subcontractor** — paid through Subcontractor pay, where you record their invoices and payments. No payroll, time off, or overtime.

Subcontractors on your roster are otherwise just like employees: they sign in, get assigned jobs, and clock in and out. Engagement is separate from role, so a subcontractor can be a manager. You can set it when inviting, when adding manually, and on the edit page, and owners and admins can both change it. See [Timesheets & payroll](help:timesheets-and-payroll) and [Contractor pay](help:contractor-pay) for how each gets paid.

Roster subcontractors are not the same as the **On-call pool**, which is a list of outside people you text for cover. They don't have a login and aren't on the roster. See [On-call pool](help:on-call-pool).

## Roles and what they can open

When you invite someone, the role picker explains the options: employees see the field app, managers see the office but can't change settings, and admins have full access. Only an **owner** can change someone's role, or make someone an owner.

When an owner sets someone to **Manager** on the edit page, a **Manager access** box appears with a switch for each area. Untick anything that isn't their job and it disappears from their menu. Whatever is ticked, a manager never sees Employees, Payroll, Reports or Settings. Anyone who needs those should be an Admin. The file shows a **Limited access** tag for a manager with something switched off. The details are in [Roles & permissions](help:roles-and-permissions).

## The employee file

Clicking a person opens their file (owners and admins only). At the top: their name with role, engagement, status and **Manually added** tags, plus email, phone, pay rate, and join date. Under that is a one-line history. It runs Applied, Hired, Joined, Deactivated, with dates. The applied and hired dates come from an applicant record with the same email, if there is one.

The buttons at the top are **Add bonus**, which opens Bonuses with this person already picked, and **Edit details**. Below, the file collects:

- **Accommodations & health**, at the top when filled in, so anyone opening the file sees safety information first.
- **Internal notes**.
- **Attendance** for the last 90 days: how many jobs they were on time for, late to (with the average), never clocked in for, and ran over on. Each exception links to its job. It's a record, not a penalty; what to do about it is your call.
- **Pay invoices**: every pay period or contractor statement they've been paid on, with the PDF.
- **Pay rate history**: every change, the date it applies from, who made it, and how many unpaid shifts were re-priced.
- **Training**: every module for their level, with completion dates and progress.
- **Documents**: contracts, ID, certifications, banking and payroll forms, insurance and WCB, and anything else. Upload with **Add** in each category, up to 15 MB per file. Only owners and admins can see them.

## Editing details

**Edit details** (owners and admins) has four parts: **Personal information** (name, phone, contact email, address), **Employment** (engagement, role, pay rate, status), **Accommodations & health**, and **Internal notes**. Address, accommodations and notes are visible to owners and admins only, never to the employee.

Changing the name of someone with a login changes how they appear across the app, but not their login email or the name on their own profile.

There's also a quick-edit list at **Settings → Team members**, with role (owners only), pay rate and status for each person. Engagement, contact details and manager access are only on the full edit page.

## Changing a pay rate

The rate is locked into each shift when it's clocked in, so a new rate needs a start date. As soon as the number differs from the saved one, the form asks **When does the new rate start?**

- **From now**: shifts already worked keep the old rate.
- **From a date**: a past date re-prices unpaid shifts from that day. Shifts already on a pay run are not changed, and the history notes what that would have added or taken off. A future date schedules the change: the rate stays as it is until that day.

Lowering a rate needs one more tick, **Yes, lower the rate from … to …**, so a typo can't quietly cut someone's pay. A scheduled change shows as **Scheduled** in the file's Pay rate history, with a **Cancel** button until it takes effect.

## When someone can't sign in

On the edit page of anyone with a login, **Generate recovery link** creates a one-time password reset link you send them yourself, by text or in person. Use it when the reset email isn't arriving. Anyone holding the link can set a new password on that account, so send it only somewhere they alone can read. Only an owner can create one for another owner.

### Before they go: last working day

When someone has given notice, open their edit page and set **Last working day**. They stay active and keep every visit up to that date. After it:

- Nobody can put them on a visit. A save that tries says so, with their name and the date.
- Putting them on a recurring series with **This and all future** puts them on the visits up to that date and leaves them off the rest.
- Any visit they were already on after that date loses them the moment you save the date, and is marked **Needs cover** on Bookings so you can pick someone else.
- The crew picker shows them as unavailable for those dates, and your online booking page stops offering their times.

A recurring series they are on still names them: each new batch of visits after the date is made without them until the series gets a new crew. The **Last working day** card lists those series, each with a link to the visit to open. There, press **Change crew**, pick who takes over, and choose **This and all future**.

Their profile shows a **Last day** tag. **Clear** removes the date; the visits they came off stay as they are. Once they've gone, disable them as below.

## When someone leaves

Set their **Status** to **Disabled** on the edit page and save. Nothing is deleted. You can't disable yourself, and you can't disable the only active owner: make someone else an owner first.

**Before you save**, the edit page shows what disabling them today would leave owed: unpaid hours, pending bonuses (each with its own **Mark paid** button), tips, pay runs not yet marked paid, approved future time off, and flagged shifts. Choosing Disabled also reveals an optional **Reason for leaving**. It's saved on their file for owners and admins only, and cleared if they're reactivated.

**The moment you save:**

- Their sign-in stops working.
- They're taken off every upcoming job, as lead or as crew, and off any recurring series, so new visits aren't made with them on them. The jobs are updated on Google Calendar too.
- If they're still clocked in, the shift is closed and flagged for review on Timesheets.
- Their pending time-off requests are cancelled.
- The office gets a notification listing the jobs that lost their cleaner, plus any pending bonuses or approved future time off still on the books.

**Afterwards**, their file shows an **Ending the employment** card. It lists everything still open, each line with a link to where you fix it:

- Pay runs or contractor statements that include them but aren't marked paid. Open each run and mark it paid once the money has gone out.
- Unpaid hours. The next pay run picks these up.
- Pending bonuses. No pay run will ever pick these up for someone who has left, so pay or delete them on Bonuses.
- Tips owed, which you settle on Payroll.
- Approved future time off. This isn't in the total; pay it out or remove it.
- Shifts still flagged for review.
- Any future jobs they're still on, for example ones assigned by hand afterwards.

The card reads *Nothing open* once every line is clear. They move to the **Archived** tab.

### Rehiring

For someone who had a login, open their edit page and set **Status** back to **Active**. Update their role or pay rate while you're there. Sending them a fresh invite is blocked, because their old record still exists. Someone who was added manually and never had a login rejoins through an invitation to the same email, which reactivates their old record.

## Deleting someone

Disabling is almost always the right move. For mistakes, owners get a **Danger zone** at the bottom of the edit page:

- **Delete employee** appears once someone is disabled. It removes them from your company but leaves their login. It only works for someone with no recorded shifts, bonuses or payroll history, because that history is what payroll, invoices and job records are built from.
- **Force-remove employee** removes them and deletes their login in one step, whatever their status. It's for a broken or stuck account you want to re-invite from scratch. It has the same work-history rule. If their login also belongs to another company on Sollos, only your company's record is removed.

## Common questions

**My new cleaner never got the invite email. What now?** The dialog shows the invite link either way. Copy it from there, or from the **Pending invitations** panel, and text it to them. Check the address too: an invite only works for the email it was sent to.

**What's the difference between Invite and Add manually?** Invite gives them a login: field app, clock in and out, chat. Add manually puts them on schedules, timesheets and payroll with no login. You can invite a manual person later with the same email and their history moves to the new login.

**I changed someone's pay rate. Why do their old shifts still show the old rate?** Each shift keeps the rate it was clocked in at. To re-price shifts already worked, change the rate again and pick **From a date** with a past date. Unpaid shifts from that day take the new rate; shifts already on a pay run don't.

**Can a manager see pay rates?** No. Pay rates, employee files, Payroll, Reports and Settings are for owners and admins only. Give someone the Admin role if they need them.

**How do I switch someone from employee to subcontractor?** Open **Edit details** and change **Engagement**. From then on they're paid through Subcontractor pay instead of payroll. Hours they worked as an employee still settle in payroll.

**Someone left. Do I have to reassign their jobs?** Sollos takes them off every upcoming job and recurring series when you disable them, and sends the office a list of the jobs that lost their cleaner. Putting someone new on those jobs is up to you.

**Can I delete an old employee to tidy up the list?** Disabled people move to the **Archived** tab and out of the way. Deleting is only allowed for someone with no shifts, bonuses or payroll history, so anyone who actually worked stays disabled.

**How do I reset an employee's password?** Open their edit page and use **Generate recovery link**, then send the link to them directly.
`,
};
