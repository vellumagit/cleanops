import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "bonuses",
  title: "Bonuses",
  blurb: "Review and efficiency bonus rules, one-off bonuses, and how bonuses get into payroll.",
  section: "Your team",
  paths: ["/app/bonuses", "/app/settings/bonus-rules"],
  keywords: ["incentive", "reward", "performance bonus", "spiff", "tip", "commission", "five star", "rating bonus", "efficiency", "extra pay"],
  body: `
Bonuses reward your team on top of their hourly pay. Sollos can award them automatically from two rules, one based on client reviews and one on finishing jobs faster than booked, and you can add one-off bonuses whenever you like. Pending bonuses for employees ride along with the next payroll run. Bonuses and their rules are for owners and admins only.

## Setting the rules

Go to [Settings → Bonus rules](/app/settings/bonus-rules). Both rules start switched off.

**Review-based bonuses.** Tick **Enable review bonuses**, then set:

- **Minimum average rating**, for example 4.80.
- **Minimum review count**: how many reviews they need in the window, so one lucky five-star doesn't qualify.
- **Period (days)**: how far back to look. The default is 30.
- **Bonus amount**.

An employee qualifies when the reviews credited to them in the last *Period* days average at least the minimum rating, across at least the minimum number of reviews. See [Reviews](help:reviews) for how reviews are tied to a cleaner.

**Efficiency bonuses.** Tick **Enable efficiency bonuses**, then set:

- **Min hours saved**: the total across all their jobs in the period.
- **Min completed jobs**: jobs with clock-in and clock-out data.
- **Bonus amount**.

Efficiency uses the same **Period (days)** as the review rule. For each completed job in the period, Sollos compares the time that person was booked for with the time they actually clocked on it, adding up every clock-in and clock-out on that job. On a job whose hours are split across the crew, each person is measured against their own share, not the full booking. Only time saved counts: finishing early adds to the total, and running over doesn't take anything away. They qualify when the time saved reaches **Min hours saved** across at least **Min completed jobs**.

Click **Save rules**. The defaults, before you change anything, are 4.80 stars across 5 reviews in 30 days for $50, and 5 hours saved across 10 jobs for $25.

## How bonuses get awarded

- **Automatically, weekly.** Every Monday morning, Sollos checks the review rule for every company that has it switched on and awards any review bonuses that are due. Owners and admins get a notification saying how many were awarded.
- **When you press a button.** At the top of **Bonuses**, **Review bonuses** checks the review rule now, **Efficiency bonuses** checks the efficiency rule, and **Compute all** does both. A message says how many bonuses were created and how many people were skipped.

Efficiency bonuses are only ever awarded when you press **Efficiency bonuses** or **Compute all**. The weekly run covers reviews only.

Every bonus Sollos awards starts as **Pending**, with the reason written on it, for example "Avg 4.92 across 7 reviews (last 30d)".

## Adding a one-off bonus

For a referral, an anniversary, or an outstanding month:

1. On **Bonuses**, click **Add bonus**, or use **Add bonus** on the person's employee file to open it with them already picked.
2. Choose the **Employee** and enter the **Amount ($)**, plus a reason if you like.
3. **Period start** and **Period end** default to today. The period end decides which pay period it's paid in.
4. Click **Add bonus**.

If a payroll run already covers the period end you chose, Sollos refuses and says which run. A bonus dated into a period that's already been run would never be picked up. Date it in the current period instead.

## How bonuses reach payroll

When a payroll run is created for a pay period, it includes every **pending** bonus whose period end falls inside that period, for people paid as employees. The bonus is then part of that run. When the run is marked paid, the bonus is marked paid with it. On the cleaner's side, their pay history in the field app shows how much of each payment was bonus or time off.

A few exceptions to know about:

- **Subcontractors.** Bonuses for people paid as subcontractors aren't added to payroll runs or to contractor statements. Pay them yourself and click **Mark paid**.
- **People who've left.** No pay run picks up a pending bonus for someone who's been deactivated. Their employee file lists it under **Ending the employment** so you can pay it or delete it. See [Employees & team members](help:employees).
- **Paying outside payroll.** **Mark paid** on a pending bonus records that you paid it some other way, and keeps it out of future runs. It's refused for a bonus already inside a payroll run, which gets paid with that run.

More on runs is in [Timesheets & payroll](help:timesheets-and-payroll).

## Editing and deleting

Click the pencil on a bonus to change its amount or reason, or to **Delete** it. Both are blocked once a bonus is inside a payroll run: delete that pay period, change the bonus, then create the period again. A bonus marked paid is a record of money that has already moved, and can't be edited or deleted.

## Common questions

**Why did nobody get an efficiency bonus this week?** Efficiency bonuses are never awarded automatically. Press **Efficiency bonuses** or **Compute all** on the Bonuses page. Check that **Enable efficiency bonuses** is ticked in **Settings → Bonus rules**.

**Can pressing Compute twice pay someone twice?** No. Anyone who already has a bonus of that kind whose period reaches into the window is skipped, whether you press again the same day or a week later. Once their last bonus's period is entirely before the window, they can earn the next one. A review bonus and an efficiency bonus are separate: having one doesn't stop the other.

**Will the bonus be in their next paycheque?** Yes, if they're paid as an employee and the bonus is pending with a period end inside the pay period being run. It isn't included if it was dated into a period already run, if they're a subcontractor, or if they've left.

**How do I give a bonus to just one person?** Click **Add bonus**, or open their employee file and click **Add bonus** there.

**Why can't I edit this bonus?** It's either inside a payroll run or already marked paid. For a run, delete that pay period, edit the bonus, then create the period again.

**I want to stop automatic review bonuses.** Untick **Enable review bonuses** in **Settings → Bonus rules** and save. Bonuses already awarded stay as they are.
`,
};
