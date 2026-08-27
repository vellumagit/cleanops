export const body = `
A checklist is a reusable template — items with an optional before/during/after phase — that lands on bookings, where cleaners tick items off in the field app. When a template lands on a booking its items are *copied*, so later edits to the template never rewrite what was actually checked on a finished job.

## Three ways to attach one

- **By service** — open a template and pick a service under **Auto-add to a service**. From then on, every booking of that service gets the checklist: hand-made, recurring, and the ones already on the calendar (saving backfills upcoming visits immediately).
- **By client** — at the bottom of a template, **Assign to clients**. That client's every booking gets it — house-specific quirks like "feed the fish" or "double-lock the side door".
- **By hand** — on any single booking, attach any template just for that job.

They stack: a deep clean for a client with her own checklist shows *both* lists, without duplicates.

## Taking one back

Revoking works the way you'd hope:

- **Delete a template** and its items come off upcoming, unstarted bookings.
- **Switch its service** (or set it to manual) and the old service's upcoming bookings give it back.
- **Unassign from a client** and that client's upcoming bookings give it back.

Past, in-progress, and completed jobs always keep their copy — that's the record of what was actually done, and it doesn't rewrite.

> Don't set a *client-named* template to auto-add by service — that would put one client's house quirks on every booking of that service. Client templates attach by client; service templates attach by service.

## What the cleaner sees

The job's checklist with tick-able items, grouped by phase, with a progress count. Required items stand out. Ticks are per-job — checking something on Tuesday's visit never checks it on Thursday's.
`;
