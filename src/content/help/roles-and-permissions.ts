import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "roles-and-permissions",
  title: "Roles and permissions",
  blurb: "Owner, admin, manager, and employee — what each can open, and how to limit what a manager sees.",
  section: "Start here",
  paths: [],
  keywords: ["access", "permission", "role", "admin", "manager", "owner", "employee", "cleaner", "restrict", "hide invoices", "capabilities", "subcontractor", "who can see"],
  body: `
Everyone on your team has one **role**, and the role decides which part of Sollos they use and what they can open. On top of that, an owner can narrow down what an individual manager sees. This guide explains both.

## The four roles

- **Owner** — everything, always. Only an owner can change anyone's role, set a manager's access, give or take away the owner role, or schedule the company's deletion.
- **Admin** — everything an owner can do except those owner-only actions. Admins run billing, settings, payroll, and the team.
- **Manager** — the office, without Employees, Applicants, Hiring, Payroll, Reports, or Settings. What else a manager sees can be narrowed one area at a time (see *Manager access* below).
- **Employee** — the field app only. Cleaners see their own jobs, shifts, clock, pay, and chat. If someone with this role opens an office link, they're sent to the field app.

Owners, admins, and managers can also use the field app for their own jobs with **Switch to Field View** at the bottom of the sidebar — handy when the person running the office also cleans.

A company can have more than one owner. Sollos won't let the last active owner be demoted or disabled — promote someone else first.

## What each role sees in the office

Owners and admins see every entry in the sidebar. Managers see:

- **Always** — Dashboard, Bookings, Requests, Contracts, Checklists, Tasks, Inventory, Network, Reviews, Bonuses, Training, Announce, Text replies, Feed (when it's switched on), Chat, Help, Feedback, and Notifications.
- **Only with Scheduling access** — Calendar and Scheduling (and the **Schedule** tab on a phone).
- **Only with Invoices & estimates access** — Invoices and Estimates, and the money cards on the dashboard.
- **Only with Client records access** — Leads and Clients.
- **Only with Timesheets & time off access** — Timesheets.
- **Only with On-call pool & subcontractor pay access** — On-call pool.
- **Never** — Employees, Applicants, Hiring, Payroll, Reports, Settings.

The same rules apply to Quick actions: a manager without Invoices & estimates access doesn't get **New invoice** or **New estimate**, and so on. The assistant follows them too — it won't mention invoice counts to a manager without that access.

## Manager access

An owner sets what each manager can open.

1. Go to **Employees** and open the manager.
2. Edit them. With **Role** set to Manager, a **Manager access** box appears.
3. Untick anything that isn't this manager's job, then save.

The five areas:

- **Scheduling** — the scheduler and calendar: create, move and assign jobs, offer shifts, change job status.
- **Timesheets & time off** — hours worked, editing time entries, approving time-off requests, including what each person earned for those hours.
- **Invoices & estimates** — invoices, estimates, payments, and client balances.
- **Client records** — client profiles, properties, contact details, and notes. With it off, the manager still sees the client's name on a job they're scheduling.
- **On-call pool & subcontractor pay** — the on-call cleaner list, shift offers to them, and what subcontractors are owed.

Everything is on until you untick it, so a new manager starts with full manager access. An unticked area disappears from their menu, and its pages send them back to the dashboard. The change takes effect when you save.

The box only appears for managers. Owners and admins always have everything, and there's no way to switch areas off for them. If someone needs to manage the team or change settings, make them an **Admin**.

> Manager access divides work inside a team you trust. It decides what the app shows and lets a manager do; it isn't meant as a security wall against someone on your own team.

## Changing someone's role

Only owners can change roles. Either open the person in **Employees** and edit them, or use **Settings → Team members** and the pencil next to their name. Admins can still edit pay rates and status there; they just don't see the **Role** field.

When you invite someone from **Employees → Invite**, you choose **Employee**, **Manager**, or **Admin**. Nobody can be invited straight in as an owner; an owner promotes them afterwards.

Setting someone's **Status** to *Disabled* stops them signing in and hides them from assignment lists. You can't disable yourself.

## Employee or subcontractor?

That's a separate question from role. Each person on the roster also has an **Engagement**:

- **Employee** — paid through payroll; accrues PTO and overtime.
- **Subcontractor** — paid through subcontractor pay, where you record their invoices and payments; no payroll, PTO, or overtime.

Engagement only decides how someone is paid. A subcontractor can have any role — a subcontractor can even be a manager — and works the field app exactly like an employee. See [Employees](help:employees) and [Contractor pay](help:contractor-pay).

People in the **On-call pool** are different again: they aren't on your roster, have no login, and claim open shifts by text. See [The on-call pool](help:on-call-pool).

Someone added with **Add manually** in Employees is on the roster but has no login, so they can't use any part of Sollos — you assign and pay them, they never sign in.

## Common questions

**My manager can't open Payroll or Settings. How do I give them access?** Managers never get Employees, Applicants, Hiring, Payroll, Reports, or Settings, whatever is ticked. Change their role to **Admin**.

**How do I stop a manager seeing invoices and revenue?** Open them in **Employees**, edit, and untick **Invoices & estimates** under **Manager access**. Invoices, Estimates, and the money cards on the dashboard disappear for them.

**Why can't I see the Role field when I edit someone?** Only owners can change roles. Admins see everything else on the form.

**Can I limit what an admin sees?** No. Owners and admins always see everything. To limit someone, make them a Manager and untick the areas they shouldn't open.

**A cleaner says they can't get into the office pages.** That's by design — the Employee role uses the field app. If they need office pages, give them the Manager role.

**Can I make someone an owner?** Yes, if you're an owner: edit them and set **Role** to Owner. Admins can't assign or change the owner role.
`,
};
