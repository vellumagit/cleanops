import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "bookings",
  title: "Bookings",
  blurb: "Creating, pricing, staffing, editing and cancelling visits — the bookings list, the booking page, notes for the crew, and deletes.",
  section: "Scheduling & jobs",
  paths: ["/app/bookings","/app/bookings/new","/app/bookings/[id]","/app/bookings/[id]/edit"],
  keywords: ["job","visit","appointment","clean","schedule a job","cancel a job","price","crew","notes","door code","access","duplicate","book again"],
  body: `
A booking is one visit: who, where, when, what kind of work, and what it costs. Everything else in Sollos — hours, invoices, checklists, the calendar — hangs off bookings, which is why a tidy booking habit keeps the whole system honest.

Owners, admins and managers can create and edit bookings. The buttons on a booking's own page (complete, duplicate, change crew and so on) are for owners and admins.

## Creating one

Every route lands on the same form, partly filled in:

- **New booking** on the bookings list, or [Bookings → New](/app/bookings/new). The floating **+** on a phone goes here too.
- **New booking** on a client's profile, or **Book** on their row in the clients list. The client and their address arrive filled in, and so do the service, length and price of their most recent booking that wasn't cancelled.
- An empty slot on the scheduler or the calendar — the time (and on the day view, the cleaner) arrive filled in.
- **Create booking** on a request — the client's preferred date, address and notes arrive filled in, and saving marks the request scheduled. See [Requests](help:requests).
- **Book this job** on an estimate — the client, the price and the estimate's description (as notes) carry over, and the booking links back to the estimate.
- **Book again** and **Duplicate** on an existing booking. Both open the form with everything that job knew: client, crew, service, hours, price, address and notes. **Book again** (on completed jobs) leaves the date empty for you to pick; **Duplicate** keeps it. Nothing is created until you press **Create booking**. A completed job in a client's booking list has the same Book again shortcut.

## The form, field by field

- **Client** — type to jump in the list. Picking a client fills a blank address from their property or profile, a blank notes box from their standing client note, and the crew with their preferred cleaner if nobody is picked yet. It never overwrites something you already typed.
- **One-time / Recurring** — the toggle at the top. Recurring swaps the date for a repeat pattern; see [Recurring series](help:recurring-series).
- **Scheduled at** — the date and start time. Underneath, the form names the day you picked — *Wednesday, September 16* — and lists what is already booked on it. A phone's date picker never says which weekday you landed on, so this is how you tell a free Tuesday from a full one without leaving the form.
- **Duration** — how long the visit is booked for. Picking a service fills it from the service's default length if it's still empty.
- **Service** — what kind of work. Services come from [Settings → Services](/app/settings/services); with none set up, the form says so and won't save. The service drives calendar colours, reports and any checklist attached to that service, and fills in its default price and length when those fields are blank.
- **Status** — Pending, Confirmed, and so on (see below). New bookings default to Confirmed. A visit more than four hours away isn't offered In progress or Completed.
- **Crew** — tap names to put people on the job; tap again to take them off. Everyone picked is on it equally. Leave it empty to keep the job unassigned.
- **Total** — what the client will be billed for this visit. Tick **This one's free** for a comp clean: the total is locked at $0 and the "No price" warning stays away.
- **Property** — appears when the client has properties on file. Switching property rewrites the address, so a cleaner isn't sent to the wrong unit.
- **Address** — with address suggestions as you type.
- **Notes for this booking** — instructions for this visit (see *Notes, access and what the crew sees*).

The save button reads **Create booking** (or **Create recurring booking**).

### Who is free at that time

Once a date, time and length are in, the **Crew** field only lists the people who are free, and tucks the rest under **Show N who aren't free then**, each with the reason: *Off that day* (approved time off or a day marked unavailable), another job at that time, or outside the hours they said they work. You can still pick someone from that list — their name turns amber with the reason — and the save's own check has the final word. If the check can't run, the form lists everyone and says so. A pale warning triangle beside a name means that person has an accommodation note on file; check their employee file before assigning.

A person on approved time off makes the save stop and ask whether to book them anyway. Someone already booked on another job at that time is refused, with the clashing job named. An owner, admin or manager then sees a **Book anyway** button: press it to save the visit with the overlap and sort it out later. This works on a visit that is already **Completed** too, for example one that ran over into the cleaner's next job and is being made longer to match. The same button is in the **Change crew** pop-up, and in the message when a drag on the scheduling board is refused. Both jobs show as *Double-booked* on the bookings list, the scheduling board and the visit's own page until one of them moves, and the press is kept in the audit log. A changed save (another time, someone else added) asks again. **Book anyway** never overrides a cleaner's last working day.

## Price, hours and crew size

Prices live on bookings; wages live on people. What you charge the client never touches what a cleaner earns — pay comes from each person's rate in Employees, applied to their clocked hours.

*Price the job when you book it.* A booking with no total and no hourly rate is flagged **No price** everywhere and never produces an invoice. The form only has a **Total** box; a booking can carry an hourly price instead only when it came from somewhere that sets one (such as an estimate), and its page then shows the rate as "$45.00/hr".

**Duration is the job's full length** — how long it would take one person. When two or more people share the visit, you can show each of them their share:

- If your company divides team hours (**Settings → Payroll & timesheets → Payroll & timesheet automations**), every team job does, and the form says *Hours are divided evenly across the crew*.
- Otherwise each team booking has its own tick, **Divide the hours evenly across the crew**.

Divided, a 4-hour job with 2 cleaners shows each of them about 2 hours in the field app. Their pay still comes from their own clock-in and clock-out, and the client's bill doesn't change. Sollos also uses the share when it checks for clashes and who is free — two cleaners on a divided 4-hour job are each treated as on site for 2 hours — and the booking confirmation email tells the client roughly when the crew will finish.

## Crew arriving at different times

Pick everyone in **Crew**. If they all arrive together, that's it. If they don't, tick **Different times for each person** (shown once two or more people are on a one-time booking) and give each one an **Arrives at** time and a **Time on site** — say 9:00 AM for six hours, 11:00 AM for six, 1:00 PM for five. Times can overlap (working together), run end to end (a hand-off), or leave a gap. Under the list the form adds up **Hours worked** and **Job runs**, and warns if the span doesn't match the Duration field.

Each cleaner's phone shows their own arrival time, each clocks in and out for themselves, and pay comes from their own clocked hours. An arrival can't be earlier than the job's start time — move the job earlier if someone comes first. Recurring series don't take per-person times.

## Notes, access and what the crew sees

Three kinds of note reach the crew, and they live in different places:

- **Notes for this booking** — this visit only. The crew sees it as **This job** on their job screen, and it shows on the booking page and the scheduler's quick view. It isn't shown to the client in their portal.
- **Client notes** — the standing note on the client's profile (pets, alarm, "move the sofa"). Read live, so editing the profile updates every job at once. The crew sees it on every visit, and a subcontractor who claims an offered shift sees it after claiming. On the booking page it has an **Edit** link to the client.
- **Client note for this visit** — what the client typed for one visit in their portal, or what you typed into the **Client note for this visit** box on the booking page when they phoned it in (**Add note**). The crew sees it boxed in amber as *From the client, for today*.

**Getting in** — door codes, lockbox, buzzer — belongs on the client's property (the **Getting in** field on their Properties card). It appears on the cleaner's job screen directly under the address, but only when the booking has that property selected.

The crew's screen also has the address with **Open in Maps**, the client's phone number, the checklist and photos.

## Who gets told when you book

- **The crew** — everyone on it gets a notification, if **Notify employee on booking assignment** is on in [Settings → Team alerts & housekeeping](/app/settings/team-alerts). The job appears in their field app either way, and they can accept it there; the booking page shows each person as *Accepted* or *Awaiting response* under **Crew response**.
- **The client** — a booking confirmation by email and/or text, if **Booking confirmation email** / **Booking confirmation text** are on, and by the client's own channel preference. A **Pending** booking never sends one; the confirmation goes when you confirm it.
- **Google Calendar** — the company calendar and each cleaner's connected calendar pick it up.

## The bookings list

**Bookings** in the sidebar holds the 1,000 most recent bookings. When there are more, a note above the table says so; open a client to see all of theirs.

- **Tabs** — **Upcoming** (today onward), **Today**, **Past**, **All**, each with a count.
- **Search** — client, service, address or cleaner. A search looks across every tab, past and future.
- **Filters** — **Status**, **Client**, **Service** and **Assignee** (including *Unassigned*); **Clear** resets them. The tab, search and filters live in the web address, so a filtered view survives a trip to the editor and can be bookmarked.
- **Table or cards** — the two icons beside Filters. Phones default to cards.
- **Columns** — When, Client, Service, Duration, Assigned, Status, Total. A row with notes shows the first line under the client's name.
- **Chips** beside the client name — a repeat icon (with the rule, on wide screens) for a recurring visit, **Split · N** for per-person times, and warnings: **Double-booked**, **Possible duplicate**, **Booked on a day off**, **Needs cover**, **Never staffed**, **Starts soon · no one assigned**, **Still in progress**, **No price**. Hover a chip for what to do. A warning sign beside the crew means someone on the job has been deactivated.
- **Status** — change it right in the row (see below).
- **Assign / Change** — opens the crew pop-up without leaving the list. An unassigned job also gets an **Offer** button to [offer the shift](help:shift-offers).
- **Total** — "No price" or "Free clean" when there's no amount.

Click a row to open its edit form. **Show archived** switches to old jobs that were automatically archived (a read-only list); **Back to active** returns. Above the table, **Requests (N)** and **Recurring (N)** appear when you have any.

## The booking page

Open a booking's full page from **Full details** on the scheduler, **View booking** on the calendar, a client's booking list, an invoice, or the dashboard. Owners and admins get these buttons along the top:

- **Mark complete** — closes a confirmed or in-progress job. It refuses a Pending job ("Confirm this job before closing it") and says why when it can't.
- **Generate invoice** — on a completed job with no invoice yet (needs invoicing access). Once an invoice exists, a link to it shows instead, with its number, amount and status.
- **Book again** (completed jobs) and **Duplicate** — see *Creating one*.
- **Make recurring** — turns a one-off into a series. See [Recurring series](help:recurring-series).
- **Assign crew** / **Change crew**, **Offer shift**, and **Edit**.

Below: the client and address, status, a one-line summary of where the job stands, **Repeats**, **Scheduled**, **Duration**, **Total**, **Assigned**, **Crew response**, a timeline of what happened on the job, anything the client said about this visit, the notes, **Job photos**, **Home photos & videos**, the **Checklist** (owners and admins can attach a template here), and **Subcontractor offers** for this job. On the right: **Paid in advance** (owners and admins record money the client paid before the invoice exists — it moves onto the invoice by itself), **Client contact**, and **Meta** (when it was created, the hourly rate, and **View estimate** if it came from one).

## Editing a booking

**Edit** opens the same form with a **Save changes** button. A recurring visit also asks **Apply changes to**: **Just this booking** or **This and all future bookings** — see [Recurring series](help:recurring-series).

When a save would notify the client — the visit time moved, or a recurring schedule was rewritten — Sollos stops and asks: **Save & notify client**, or **Save without notifying** (you tell them yourself). The notice goes by the client's own channel preference, and only if the **Booking rescheduled** email or text automation is on. Pending bookings never notify, and saves that change nothing client-visible don't ask.

Changes to a job's hours or price are written into the job's timeline, with who made them.

## Moving a job

Drag a job to a new time or person on the scheduler (owners, admins and managers), or change it on the booking. A drag tells the client the new time (same automations and preferences as above); the booking form asks first. Either way the crew gets a push, and Google Calendar — yours and each cleaner's — moves within a minute or two. A move to a day someone marked off still goes through, with a warning naming who is off. More in [Scheduling & calendar](help:scheduling-board).

## Photos

**Job photos** are taken on the job: tap **Before**, **After**, or **Other**, then **Take photo** to use the camera or **From gallery** to add pictures already on the phone (several at once is fine). Big photos are shrunk on the phone before they upload, so they go through on slow data too. The office sees them on the booking.

**Home photos & videos** are about the place itself, not one clean: the pictures and videos a client sends for a quote, where the key is, the state the home was in before you started. Add them on the client's profile or on a booking (owners, admins and managers) with **Take photo**, **Record video** or **From gallery**, plus an optional note. On a booking, **Keep with the client, so every visit shows it** decides whether one follows the client or belongs to that booking only. Everyone on the team sees them on the job, so a cleaner going somewhere for the first time knows what to expect. Videos can be up to 50 MB each, roughly 30 seconds of phone video.

## Availability on the scheduler

Who has said they're working which hours, days marked off, and statutory holidays all show on the scheduler — see [Scheduling & calendar](help:scheduling-board). Cleaners set their hours in the field app under **Profile → My availability**; see [Availability & time off](help:availability-and-time-off).

## Status, and changing it back

A booking moves **Pending → Confirmed → In progress → Completed**, and can be **Cancelled** along the way. Set it from the dropdown on the bookings list, from a job's quick view on the scheduler, or on the booking's own form. On a recurring visit the dropdown asks how far it goes: **This visit only** or **This and all future visits** (up to 60 visits at a time; the message says if some were left unchanged and why).

**Pending** means penciled in, not agreed. It shows amber everywhere, is never auto-completed or invoiced, never sends the client a confirmation, and can only move to Confirmed or Cancelled.

For a job that has already happened, status only moves forward. A completed job can still be set to **Cancelled** — but not out from under an invoice: if a live invoice bills it, void or fix that invoice first. A cancelled job stays cancelled.

Bringing a cancelled future job back (Cancelled to Confirmed or Pending) puts its crew back on the schedule. If one of them has been given another job at that time since, the change is refused with the job named, and an owner, admin or manager can press **Book anyway** in that message to bring it back with the overlap.

**A job scheduled in the future is different**, because it's a plan rather than a record. Anything more than four hours out can be set freely to **Pending, Confirmed or Cancelled** — including back to Pending after you move it. That's the one to reach for when you reschedule and the client hasn't agreed to the new time yet: the "your job is tomorrow" reminder only goes out for **Confirmed** jobs. Future jobs aren't offered *Completed* or *In progress* at all.

## Cancelling a job

Set the status to **Cancelled**. Sollos then:

- pushes a notice to everyone on the crew,
- sends the client a cancellation notice by their channel preference — if **Booking cancelled email** / **Booking cancelled text** are on in Automations, and only once per booking (a client marked do-not-contact gets none),
- takes the visit off every Google Calendar.

A job that was already completed when you cancel it gets no notices. If the client paid in advance, the **Paid in advance** card stays on the cancelled job to remind you to refund it or move it to their next visit. To end a whole recurring schedule, see [Recurring series](help:recurring-series).

## Recurring

Repeat schedules — patterns, how far ahead visits are made, editing *just this one* versus *this and future*, skips, ending a series, and the billing chips — have their own guide: [Recurring series](help:recurring-series).

## Deleting and skipping

Both live in the **Danger zone** at the bottom of a booking's edit page.

- **Skip [date] only** is for one upcoming visit of a recurring series that shouldn't happen — the visit is removed, the date goes on the series' skip list so it isn't made again, and the series continues. It doesn't message anyone.
- **Delete booking** removes the booking. Past bookings can be deleted too (you'll get a firmer warning); hours logged on it are kept in Timesheets, just unlinked. A booking a live invoice bills is refused, with a link to the invoice: void or delete it first. On a recurring visit, ticking **Also remove the rest of the series** deletes this visit and every future one (**Delete this + future**); past visits are kept.

Deleting sends no message to the crew or the client. If the client or crew should hear about it, cancel the job instead.

## Common questions

**Why didn't my client get a confirmation?** The booking confirmation only goes out when **Booking confirmation email** or **text** is on in Settings → Client messages, the client's channel preference allows it, and the booking isn't Pending. A Pending booking gets its confirmation when you change it to Confirmed.

**How do I stop the client being told about a time change?** When the edit form asks, choose **Save without notifying**. A drag on the scheduler does notify (if the rescheduled automations are on), so use the form when you'd rather tell them yourself.

**Why can't I mark this job complete?** Pending jobs have to be confirmed first, cancelled jobs can't be completed, and a job more than four hours in the future isn't offered Completed at all. Mark complete shows the reason when it refuses.

**Where do I put the door code?** On the client's property, in **Getting in**. It shows under the address on the cleaner's job screen — as long as the booking has that property picked.

**Does the duration change when I add a second cleaner?** No — Duration stays the full one-person length. If hours are divided (company-wide or the tick on the booking), each cleaner sees their share of it in the field app.

**I deleted a booking by mistake. Can I get it back?** No — deleting can't be undone. Hours logged on it are still in Timesheets and can be re-attached. Next time, cancel instead: a cancelled booking stays on record.

**Why does a booking say "Needs cover"?** Someone was left off that visit when a recurring series' crew was saved, because they had another job then. Open the visit and pick someone else, or press **Put them on anyway** on the visit's page to keep them on it double-booked; see [Recurring series](help:recurring-series).

**Can a manager use the buttons on the booking page?** Managers can create and edit bookings and change status from the list, but the buttons along the top of a booking's page are for owners and admins.
`,
};
