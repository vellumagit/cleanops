import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "getting-around",
  title: "Getting around Sollos",
  blurb: "The three surfaces, the sidebar and badges, the phone layout, quick actions, and Tips & shortcuts.",
  section: "Start here",
  paths: ["/app/settings/tips"],
  keywords: ["navigation", "menu", "sidebar", "layout", "home", "start", "shortcuts", "tips", "command palette", "ctrl k", "install", "home screen", "sign out", "log out", "switch company"],
  body: `
Sollos has three surfaces, and knowing who lives where explains most of the layout:

- **The office** (where you are now) — owners, admins, and managers run the business here: bookings, clients, money, people. Someone with the Employee role who opens an office link is sent to the field app instead.
- **The field app** — cleaners see their jobs, clock in and out, tick checklists, upload photos, and chat. If you also clean, **Switch to Field View** at the bottom of the sidebar (**Field view** in the phone's More sheet) opens it for your own account. See [The field app](help:field-app).
- **The client portal** — clients see their visits and make requests. Clients sign in there; they are never members of your team. See [The client portal](help:client-portal).

## Installing Sollos on a phone

Sollos installs to the home screen like an app, and one icon serves everyone: it opens the field app for cleaners, the office for owners, admins, and managers, the portal for clients, and the sign-in page if nobody is signed in.

On a phone, the office shows an **Install Sollos** banner:

- **Android** — tap **Install app**.
- **iPhone in Safari** — tap the Share button, scroll down, and tap **Add to Home Screen**.
- **iPhone in another browser** — the banner asks you to open the page in Safari first; Apple only allows installing from Safari.

Dismiss the banner and it stays away for seven days. Owners and admins also have an install card at the top of **Settings**, which says **App installed** once it's on the home screen.

## The sidebar

On a computer the sidebar runs top to bottom in the order work flows:

- **Overview** — Dashboard. See [The dashboard](help:dashboard).
- **Operations** — Bookings, Calendar, Scheduling, Requests, Estimates, Contracts, Checklists, Tasks, Inventory.
- **People** — Leads, Clients, Employees, On-call pool, Network, Reviews, Bonuses.
- **Hiring** — Applicants, Hiring, Training.
- **Money** — Invoices, Timesheets, Payroll, Reports.
- **Comms** — Announce, Text replies, Feed, Chat.

At the bottom: **Help**, **Feedback**, **Notifications**, and **Settings**, then **Switch to Field View**, then a card with your name and role and a small sign-out button.

Not everyone sees every entry. Managers never see Employees, Applicants, Hiring, Payroll, Reports, or Settings, and an owner can switch off further areas for a particular manager — see [Roles and permissions](help:roles-and-permissions). **Feed** appears only when the team feed is switched on (**Settings → Team alerts & housekeeping**, *Show team feed*).

The bell next to your company name opens Notifications; a red number on it is your unread count. Your logo and company name appear at the top once you've added a logo in **Settings → Branding** (until then it reads *Sollos 3*), and your brand colour tints the page you're on.

## Badges

The small numbers beside some entries are live counts — a badge is the app telling you something is waiting on a person:

- **Bookings** — jobs scheduled today.
- **Requests** — client requests waiting for an answer.
- **Estimates** — estimates still pending.
- **Invoices** — overdue invoices.
- **Chat** — new messages.
- **Reviews** — reviews in the last seven days.
- **Tasks** — overdue tasks.
- **Applicants** and **Leads** — new ones.

"Today" always means today in your company's time zone. On a computer, hovering a badge shows what it counts (for example *3 today*).

## On a phone

The office swaps the sidebar for an app layout.

- **The top bar** — your logo, then **+** (quick actions), the sparkle (the assistant), and the bell.
- **The bottom tabs** — **Today** (the dashboard), **Schedule**, **Bookings**, **Requests**, and **More**. Schedule and Requests only appear for people who can use them.
- **More** opens a sheet called *Everything else*: the phone-friendly pages grouped by section, plus Help, Feedback, and Notifications. Desk-shaped pages (Contracts, Checklists, Applicants, Hiring, Training, Payroll, Reports, Settings) sit collapsed under **Desktop tools**. Nothing is locked away — those pages work on a phone and just show a note that they're easier at a desk.
- Counts for pages inside the sheet add up on the **More** tab, so a new chat message or overdue task still shows.
- **Field view** and **Sign out** are at the bottom of the More sheet.

The **Schedule** tab opens the day as a timeline you can tap to book — see [The scheduling board](help:scheduling-board).

## Quick actions

Quick actions is a small menu for jumping straight to a form. Open it with the round **+** button at the bottom right on a computer, **Ctrl+K** (**⌘K** on a Mac), or the **+** in the phone's top bar. Type to filter — it matches words like "quote" or "bill" too — then use the arrow keys and Enter, or tap.

It offers **New booking**, **New client**, **New estimate**, **New invoice**, **Open calendar**, **Clients**, **Scheduling / dispatch**, and **New task** — each only if you're allowed to open that page. **Esc** closes it.

There's no search box that covers the whole app; search lives on each list (clients, bookings, invoices).

On the **Chat** page the floating buttons and the phone's **+** and sparkle step aside so they don't cover the message box. **Ctrl+K** still works there on a computer.

## The assistant

The sparkle (bottom right on a computer, top bar on a phone) opens the Sollos Assistant, which answers how-to questions from these guides. See [Asking the assistant](help:assistant).

## Help, and Tips & shortcuts

**Help**, at the bottom of the sidebar, is this manual. It has its own search, and every guide ships with the app, so it describes the version you're using.

**Settings → Tips & shortcuts** (under *Learn*) lists every fast path the app supports:

- **Type to jump** — in any dropdown, press a letter to jump to entries starting with it; press it again to cycle through them.
- **Search knows invoice numbers** — typing 0127 in the invoices search finds INV-2026-0127.
- **Bill several jobs on one invoice** — **New invoice**, pick the client, then *Bill them together* collects every unbilled job in a date range. See [Invoicing](help:invoicing).
- **Batch amounts are editable** — fix a price in the batch before creating the invoice.
- **Invoices arrive prefilled** — start one from a client's page and the client is filled in, plus the job and amount if they have exactly one unbilled job.
- **Stray hours reattach in one tap** — a blue *Looks like…* chip on a timesheet row files off-job hours onto the job they overlap.
- **Cleaners clock in with one tap** — the field clock shows today's jobs as buttons.
- **Rows open records** — click anywhere on a row in most lists.
- **Esc closes dialogs.**

The same page has the **Inline tips** switch. When it's on (the default), small lightbulbs sit next to controls that have a trick worth knowing; tap one to read it. The switch is saved on this device only, so turning it off on your laptop leaves your phone alone.

## Switching between companies

If your sign-in belongs to more than one company, Sollos opens the one you joined most recently, and accepting an invitation to another company switches you to it. There is no menu for switching back and forth. The dashboard's greeting (*Welcome back to …*) tells you which company you're in.

## Feedback

**Feedback**, at the bottom of the sidebar (under **More** on a phone), sends a problem, an idea, or a question to the Sollos team and keeps the thread. See [Feedback](help:feedback).

> If the app and this Help section ever disagree, the app changed first — these pages ship with the code, so tell us and the page gets fixed in the next deploy.

## Common questions

**Where do I sign out?** On a computer, the small arrow button on your name card at the bottom of the sidebar. On a phone, open **More** and tap **Sign out** at the bottom.

**Why can't I see Payroll, Employees, or Settings?** Those are for owners and admins only. If you're a manager, the owner can change your role or your access — see [Roles and permissions](help:roles-and-permissions).

**Why does the sidebar say "Sollos 3" instead of my company name?** The company name shows once you've uploaded a logo in **Settings → Branding**.

**Where did the Feed go?** It only shows when *Show team feed* is on in **Settings → Team alerts & housekeeping**. When it's off, the feed is hidden for everyone, in the office and the field app.

**How do I see what my cleaners see?** Tap **Switch to Field View** at the bottom of the sidebar (or **Field view** in the More sheet). It shows the field app for your own account — your own jobs and shifts.

**Can I turn off the lightbulbs?** Yes — **Settings → Tips & shortcuts**, switch **Inline tips** off. It only affects the device you're on.

**I belong to two companies. How do I switch?** There's no switcher. Sollos opens the company you joined most recently; accepting a new invitation moves you to that company.
`,
};
