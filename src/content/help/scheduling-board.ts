import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "scheduling-board",
  title: "Scheduling & calendar",
  blurb: "The dispatch board (day, week and month), dragging jobs between cleaners, availability and holidays, and the Calendar page with Google Calendar.",
  section: "Scheduling & jobs",
  paths: ["/app/scheduling", "/app/calendar"],
  keywords: ["scheduler","dispatch","board","drag and drop","reschedule","calendar","google calendar","week view","day view","who is working","availability","holiday","unassigned"],
  body: `
Sollos has two calendar-shaped pages. **Scheduling** is the dispatch board: one row or column per cleaner, built for deciding who goes where and moving jobs around. **Calendar** is a plain month/week/day calendar of everything dated — bookings, invoice due dates, tasks and your Google Calendar — for seeing the shape of the month.

Both are for owners, admins and managers who have the Scheduling area switched on (see [Roles & permissions](help:roles-and-permissions)). On the board, dragging jobs, and creating one from an empty slot, are for owners and admins; managers can open jobs and change their status.

## The dispatch board

[Scheduling](/app/scheduling) has three views — **Month**, **Week** and **Day** — and the arrows, **Today** / **This week** / **This month** to move through time.

- **Week** (the default) — cleaners down the side, days across. Drag a card to another day or another cleaner. Moving between days keeps the job's time of day. Jobs nobody is on sit in **Needs assignment** above the grid; drop a card there to take that person off it.
- **Day** — the dispatch view: a column per cleaner, half-hour rows. Click an empty slot to book that cleaner at that time; drag a card by its grip to change both the person and the start time. Cleaners with nothing that day fold into one line (*N others — nothing scheduled today*) — tap it to show them, or drag a job onto it to assign one.
- **Month** — an overview. Click a day number to open that day; click a job to edit it.

On a phone, the board turns into lists that fit: the day view becomes a single timeline (hours down the side, each job as tall as it is long, a red line for now) where you **tap any empty time to book it**, and the week view becomes a strip of seven days with that day's timeline under it. A phone with no view chosen opens on the day.

Above the grid, when there are jobs with prices in view, a strip totals **Scheduled**, **Earned** (completed jobs) and **Remaining**. Cancelled jobs never count.

### What a drag does to the crew

A team job's card appears in every crew member's row, and Sollos knows whose card you grabbed:

- Same person, new day or time — the job moves; the crew stays the same.
- Into another person's row — that one person is swapped for the new one; everyone else stays.
- Onto **Needs assignment** — that one person comes off; the job is only unassigned if nobody is left.
- Into the row of someone already on the job — refused, because it would quietly drop a person.

A move tells the client the new time (by their channel preference, if the **Booking rescheduled** automations are on), pushes the crew, and updates Google Calendar within a minute or two. A move onto a day someone has marked off still goes through, with a warning naming who is off. A drag that would double-book someone is refused with the clashing job named, and the message carries a **Book anyway** button: press it to make the move with the overlap and sort the other job out afterwards. Both jobs show the double-booked dot until one moves. A drop onto someone past their last working day is refused with no such button.

### Opening a job

Click a card for its quick view: **When**, **Crew**, **Repeats**, **Address**, **This job** notes and **Client notes**, with buttons for **Maps**, **Assign**, **Offer shift**, **Full details** (the booking page) and **Edit**. The status can be changed from here too. Saving from the editor brings you back to the same board.

### Warnings on cards

A small dot on a card means something about the job looks wrong — hover for the detail. These are the same warnings the bookings list shows as chips: double-booked, possible duplicate, booked on a day off, **Needs cover**, never staffed, starts soon with no one assigned, still in progress, no price.

### Needs coverage

When there's a gap, an amber **Needs coverage** panel sits at the top of the board: how many upcoming shifts have no cleaner, and any cleaner asking to come off a recurring client (*Olha is requesting off Smith (recurring)*), with their reason. Sort out the cover, then press **Mark handled**. A job counts as covered if it has a crew member or a subcontractor who claimed an offered shift.

## Availability, time off and holidays

- **Working hours** — cleaners can submit the hours they work in the field app (**Profile → My availability**; see [Availability & time off](help:availability-and-time-off)). On the week view they show as a green dashed chip with the hours in that person's day; on the day view, beside their name at the top of their column. A specific day marked off beats their standing weekly hours. No chip just means nothing was submitted — unknown, not unavailable.
- **Days off** — approved time off and days marked unavailable shade the cleaner's day grey ("Employee is off this day"). On a phone, the day timeline lists who is off.
- **Statutory holidays** — once a region is picked in [Settings → Currency, tax & holidays](/app/settings/currency), the holiday's name shows in violet on that day in every view. It's a label, not a block: you can still book the day. Holidays are worked out from the region (province-level rules included); no calendar account is involved.

The booking form uses the same information to show who is free when you pick a crew; see [Bookings](help:bookings).

## Filters and saved views

- **Filters** — **Show employees** (with **All** and **None**), **Hide cancelled bookings**, and **Color cards by** **Employee**, **Service type**, **Client** or **Status**. A team job stays visible as long as anyone on its crew is shown. Filters are remembered in this browser.
- **Compact** / **Comfortable** — shrinks empty rows to fit more of the week on screen.
- **Views** — saved filter combinations shared with everyone in your company. Owners and admins can save the current filters with **Save current filters as view…** and delete views.

### Keyboard shortcuts

On a computer: **←** and **→** move back and forward, **t** jumps to today, **d** / **w** / **m** switch to day, week or month, **n** opens a new booking, **/** opens the filters, and **?** lists these.

## The Calendar page

[Calendar](/app/calendar) shows, in **Month**, **Week** or **Day**:

- **Bookings** — coloured by status.
- **Invoices** — on their due date, coloured by status (paid, overdue, sent).
- **Tasks** — on their due date; see [Tasks](help:tasks).
- **Google Cal** — events from your connected Google Calendar, when there are any.

The buttons along the top turn each source on and off. It covers last month, this month and next month.

Click an event for its details and the next step: **Open in Maps**, **View booking**, **Edit**, **Open invoice**, **Open in Google Calendar** or **Edit task**. To book from the calendar, press **New booking**, click an hour on the week or day view, or the **+** that appears when you hover a day in month view — the booking form opens in a side panel, and closing it leaves you on the calendar. Clicking a day in month view opens that day.

## Google Calendar

Connect Google Calendar under [Settings → Integrations](/app/settings/integrations) and Sollos keeps your company calendar in step with your bookings: created, moved, re-crewed and cancelled jobs are created, updated and removed there. Each cleaner can also connect their own Google Calendar in the field app (**Profile → Connect Google Calendar**) to see their own jobs on it. See [Integrations](help:integrations).

## Common questions

**What's the difference between Scheduling and Calendar?** Scheduling is per cleaner and lets you drag jobs between people and times. Calendar is a straight calendar of bookings, invoice due dates, tasks and Google events, with no per-cleaner lanes and no dragging.

**Why can't I drag jobs on the scheduler?** Dragging, and booking from an empty slot, are for owners and admins. Managers can open jobs, change status and use the quick view's buttons.

**I dragged a job and the client got a message — can I stop that?** A drag sends the rescheduled notice if those automations are on and the client's preferences allow it. To move a job quietly, open it and change the time in the edit form, then choose **Save without notifying**.

**Why is a cleaner missing from the board?** Check **Filters → Show employees**, or a saved view that hides them. On the day view, people with nothing scheduled fold into one line at the edge — click it to show them.

**Why doesn't a cleaner show any availability?** They haven't submitted hours in the field app. No chip means unknown, not unavailable.

**Can I stop holidays showing?** They show for the region picked in Settings → Currency, tax & holidays. They're labels only and never stop you booking.

**Why don't I see my Google events on the Calendar?** The **Google Cal** button only appears once Google Calendar is connected under Settings → Integrations and there are events in the range shown.
`,
};
