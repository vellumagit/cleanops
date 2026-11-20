import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "first-steps",
  title: "Setting up your company",
  blurb: "The Get started checklist, and the order to set up time zone, services, branding, team, clients, and invoicing.",
  section: "Start here",
  paths: ["/app/setup"],
  keywords: ["onboarding", "get started", "setup", "set up", "new account", "first time", "checklist", "wizard", "getting started", "import clients"],
  body: `
A new Sollos company starts with a **Get started** checklist that walks the owner through the few things that make the app useful. This guide covers the checklist, then the settings worth doing first — in an order that saves you redoing work.

The checklist is for owners and admins. While setup isn't finished, the sidebar shows **Get started — Set up your workspace** at the top and the dashboard shows a *Finish setting up your workspace* banner. A brand-new company with no clients opens straight onto the checklist.

## The Get started checklist

[Get started](/app/setup) has seven steps in two groups, with a progress bar counting them off.

**Start here** — the essentials:

- **Add your first client** (**Add client**) — every job is attached to a client.
- **Schedule a cleaning job** (**Book a job**) — pick a client, a date, and a team member. Your crew sees it on their phone the moment you save.
- **Invite your team** (**Send invite**) — your cleaners get the field app to see jobs, clock in, chat, and mark work done.
- **Choose what Sollos sends for you** (**Set up automations**) — nothing goes to clients until you say so: no confirmations, no reminders, no automatic invoices. Pick email or text, then switch on what you want.

**Look professional** — optional, but do them before you send a client anything:

- **Add your logo & brand color** — it shows on invoices and client links.
- **Tell clients how to pay you** — Zelle, cheque, Venmo, bank transfer, whatever you accept; it's printed on every invoice.
- **Send your first invoice** — run the whole flow once: pick a completed job, review, send.

You don't tick steps by hand. Each one ticks itself when the thing exists — a client, a booking, an invoice, a logo or colour, payment instructions. **Invite your team** ticks once anyone else is on the team or an invitation is out. **Choose what Sollos sends for you** ticks once you've switched on the automations master switch or changed any single automation.

Each step opens the real page with a banner across the top — *You're setting up your workspace* — and a **Back to setup** button, so you never lose your place.

A collapsed panel, *New to Sollos? Here's how it works in 60 seconds*, explains the loop: clients, then jobs, then your crew works the field app, then invoice and get paid.

## Finishing setup

The button at the bottom changes as you go:

- **Skip setup for now** — while the essentials aren't all done.
- **I'm ready — go to dashboard** — once the four essentials are done.
- **Go to dashboard** — once all seven are done.

All three do the same thing: they mark setup finished for the whole company. After that the Get started link and the dashboard banner are gone and the checklist page sends you to the dashboard — it doesn't come back. Everything it pointed to is still in the sidebar and **Settings**, so nothing is lost by skipping.

## A good order to set things up

The checklist is the minimum. Owners who do these first, in roughly this order, avoid fixing things later. All of them are in **Settings** (owners and admins).

1. **Timezone** — new companies start on Eastern time (Toronto). If you're anywhere else, change it in [Settings → Timezone](/app/settings/timezone) *before* booking anything: booking times and recurring schedules are read in this zone, and changing it later doesn't move bookings you already made.
2. **Currency, tax & holidays** — how amounts display, the default sales tax on new invoices, and which region's statutory holidays mark the scheduler.
3. **Services** — the list you pick from when booking. Rename the defaults, archive what you don't offer, add your own. Services drive calendar colours, reports, and which checklist a job gets.
4. **Branding** — logo and brand colour for invoices, client links, and your dashboard.
5. **Email & contact info** — how you email clients and the contact email and phone they see.
6. **Payment instructions** — what clients see when online payment isn't set up. To take card payments online, connect Stripe or Square under **Integrations** — see [Integrations](help:integrations) and [Getting paid](help:getting-paid).
7. **Your team** — in **Employees**, **Invite** sends someone a link to create their login (choose Employee, Manager, or Admin); **Add manually** adds someone who does the work but won't sign in. Decide roles with [Roles and permissions](help:roles-and-permissions); the rest is in [Employees](help:employees).
8. **Your clients** — add them one at a time, or use **Import CSV** on the Clients page to bring in a spreadsheet (duplicates are skipped). See [Clients](help:clients).
9. **Your first bookings** — one-off or recurring. See [Bookings](help:bookings) and [Recurring series](help:recurring-series).
10. **Invoicing** — **Settings → Invoicing** decides whether drafted invoices send themselves after a review window. See [Invoicing](help:invoicing) and, for clients billed every two weeks or monthly, [Billing cycles](help:billing-cycles).
11. **Pay periods** — **Settings → Payroll & timesheets** sets the pay-period calendar that Payroll and Timesheets follow. See [Timesheets and payroll](help:timesheets-and-payroll).
12. **Automations** — turn on the client messages and team alerts you want. See [Automations](help:automations). Texting from your own number is optional — see [Texting](help:texting).

Company-wide settings are covered together in [Company settings](help:company-settings).

## Common questions

**Where did Get started go?** Someone pressed **Skip setup for now**, **I'm ready — go to dashboard**, or **Go to dashboard**. That marks setup finished for the company and the checklist doesn't return. Every step it linked to is still in the sidebar or **Settings**.

**Why does Sollos keep opening the setup page?** A company that hasn't finished setup and has no clients opens on the checklist. Add a client, or press **Skip setup for now**.

**"Invite your team" is ticked but I never invited anyone. Why?** It ticks when anyone besides you is on the team or an invitation exists — for example a co-owner or someone added manually.

**Will my clients get emails while I'm setting up?** Not from automations — every automation is off until you switch it on. Things you send yourself, such as pressing send on an invoice or estimate, do go out.

**Can an admin do the setup?** Yes. Owners and admins see the checklist and can finish it. Managers don't see it.

**I booked jobs before fixing the time zone. Are they wrong?** Changing the time zone doesn't move existing bookings, so check the ones you made under the wrong zone and correct their times by hand.
`,
};
