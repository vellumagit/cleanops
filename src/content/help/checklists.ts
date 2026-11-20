import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "checklists",
  title: "Checklists",
  blurb: "Building checklist templates, attaching them by service, by client or by hand, how cleaners tick them off, and what happens when you take one back.",
  section: "Scheduling & jobs",
  paths: ["/app/checklists","/app/checklists/new","/app/checklists/[id]"],
  keywords: ["tasks list","to-do","cleaning list","template","room by room","inspection","job list"],
  body: `
A checklist is a reusable template — rooms, groups and tasks, each task marked before, during or after the job — that lands on bookings, where cleaners tick items off in the field app. When a template lands on a booking its items are *copied*, so later edits to the template never rewrite what was actually checked on a finished job.

**Checklists** in the sidebar is for owners, admins and managers.

## Building a template

From **Checklists**, press **New template** (or [start one here](/app/checklists/new)):

- **Name** — required, e.g. "Move-out deep clean".
- **Auto-add to a service** — leave it on **No — attach by hand or per client**, or pick **Every [service] booking** (see below).
- **Description** — optional, for the office.
- **Items** — the list itself. Add rows with **Section** and **Task**. Each row's type can be **Task**, **Section** (a heading such as a room) or **Group** (a smaller heading inside a section, like "Appliances"). Headings are just labels; only tasks get ticked.

Each task has a phase — **Before job**, **During job** or **After job** — and a **Required** tick. Required tasks are labelled *Required* for the cleaner until they're done. It's a label only: it doesn't stop anyone clocking out or completing the job.

**Paste a list** turns a checklist written somewhere else into rows in one go: one line each, ALL CAPS lines become sections, short labels become groups, and everything else becomes a task. **Add below** appends them; **Replace all items** swaps out what's there. You can change any row's type afterwards.

A template needs a name and at least one task. Press **Create template** (or **Save changes** when editing). The list page shows each template's task count and, if it auto-adds, which service; **Edit** opens it and the bin icon deletes it straight away.

## Three ways to attach one

- **By service** — open a template and pick a service under **Auto-add to a service**. From then on, every booking of that service gets the checklist: hand-made, recurring, and the ones already on the calendar (saving fills in upcoming visits immediately).
- **By client** — at the bottom of a template, **Assign to clients**: pick from **Assign to a client…** and press **Assign**. That client's every booking gets it, upcoming ones included — house-specific quirks like "feed the fish" or "double-lock the side door". A client has one assigned checklist at a time, so assigning a different template to them replaces the first. **Remove** takes a client off.
- **By hand** — on a booking's page, under **Checklist**, choose from **Pick a template…** and press **Attach** (owners and admins). It's added to what's already there, so you can combine several.

They stack: a deep clean for a client with her own checklist shows *both* lists, without duplicates.

## Taking one back

Revoking works the way you'd hope:

- **Delete a template** and its items come off upcoming, unstarted bookings.
- **Switch its service** (or set it to manual) and the old service's upcoming bookings give it back.
- **Unassign from a client** and that client's upcoming bookings give it back.

Past, in-progress, and completed jobs always keep their copy — that's the record of what was actually done, and it doesn't rewrite. To take one item off a single job, use the bin icon beside it on the booking's page.

> Don't set a *client-named* template to auto-add by service — that would put one client's house quirks on every booking of that service. Client templates attach by client; service templates attach by service.

## What the cleaner sees

On the job screen in the field app, once they've accepted the shift: the **Checklist**, grouped into Before job, During job and After job, with the section and group headings, and a count such as *12/40 complete* (headings aren't counted). Tap the circle beside a task to tick it, and again to untick. Required tasks show *Required* until ticked. Ticks are per job — checking something on Tuesday's visit never checks it on Thursday's.

## What the office sees

The same checklist appears on the booking's page, with ticked tasks in green and the running count. It updates as the cleaner works, so you can see how far along a job is. Checklist items don't take photos — the job's **Before** and **After** photos are on the same page.

## Common questions

**Why isn't the checklist on today's job?** Check that the template is set to auto-add for that job's service, or assigned to that client — or attach it by hand on the booking. Jobs that were already in progress or finished when you set it up keep what they had.

**I edited a template — why didn't a finished job change?** Bookings keep their own copy. Edits reach upcoming, unstarted bookings, never past ones.

**Does "Required" stop a cleaner finishing without ticking it?** No. It's a label that stays on the task until it's ticked; nothing is blocked.

**Can a client have more than one checklist?** One assigned checklist per client, plus any that auto-add by service and any you attach by hand to a booking.

**My cleaner can't see the checklist.** The checklist shows on the job screen after they accept the shift. Ask them to open the job and accept it first.

**How do I take a checklist off one booking only?** Remove its items with the bin icon on that booking's page. The template, and other bookings, aren't affected.
`,
};
