import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "availability-and-time-off",
  title: "Availability & time off",
  blurb: "Cleaners set the hours they can work, mark a day off, and request time off. You're told, approve or decline on Timesheets, and see it all on the scheduler.",
  section: "The field app",
  paths: ["/field/availability", "/field/time-off"],
  keywords: [
    "PTO",
    "vacation",
    "holiday",
    "leave",
    "day off",
    "days off",
    "unavailable",
    "working hours",
    "schedule preferences",
    "approve time off",
    "sick day",
  ],
  body: `
Cleaners tell you when they can work in two ways. **Availability** is their usual week, plus one-off days that differ. **Time off** is a request for a stretch of days that you approve or decline. Both appear on your scheduler, and both send you a notification. The first three sections below are written for cleaners and can be forwarded as they are.

## Setting the days you can work

**Profile → My availability** opens **When I can work**.

1. Under **The days you can work**, switch on each day you can work. The switch reads **Can work** or **Can't work**. A day switched on starts at 9:00 AM to 5:00 PM. Change the times to suit.
2. **Same hours Monday to Friday** copies the first weekday that has hours onto all five weekdays.
3. **Add a second time that day** covers a split day, such as mornings and evenings. A day can have up to three times.
4. Tap **Save my hours**. The button stays on screen, with "Your changes aren't saved yet.", until you do.

Your week repeats every week until you change it. If a time doesn't make sense, the save is refused and the day is named: "The end has to be after the start." or "These two times overlap." Once saved, the page confirms it ("Saved: you can work 4 days a week."). With nothing switched on, it says the office doesn't know when you can work.

## One day that's different

Under **A day that's different**, on the same page:

1. Choose **Day off**, or **Different hours** for a day you can only work part of.
2. Pick the date under **Which day**. For different hours, set **The hours you can work that day**.
3. Add a **Note for the office (optional)**, e.g. "Doctor appointment".
4. Tap **Add day off** or **Save these hours**.

A day off takes effect straight away, with no approval needed, and the office is told as soon as you add it. Different hours replace your usual hours for that one date. Everything coming up is listed under **Coming up**. **Remove** puts that day back to your usual week.

## Requesting time off

**Profile → Time off** (the row shows how many requests are pending).

1. Enter the **Start date** and **End date**.
2. Employees also enter **Hours requested** (8 to start with, in half-hour steps, 1 to 200). That's the paid time off you're asking for.
3. Add a **Reason (optional)**.
4. Tap **Request time off**. "Request submitted. Your manager will review it soon."

**Subcontractors** don't enter hours. For them, time off marks them unavailable so nothing gets scheduled on them. It's unpaid, and the manager still approves it.

**Your requests** lists each request with its status: pending, approved, declined or cancelled.

- **Change** (the pencil) works until the first day of the request. Changing an approved request sends it back to pending, because the manager approved specific dates.
- **Cancel** works while any day of it is still ahead, even partway through ("I'm coming back early"). Cancelling approved time off puts the days back on the schedule and tells your manager.

**Day off or time off?** A day off from availability is one date, needs no approval, and carries no pay. A time-off request covers a range, waits for approval and, for employees, can be paid.

## What you're told in the office

Your owners, admins and managers get a notification when:

- **A time-off request comes in.** It leads with what needs doing: "Already on 3 jobs in that window — they'll need cover if you approve," or "Nothing is booked for them then." It opens Timesheets.
- **Someone marks a day off.** "Marked unavailable", again with the number of jobs they're on that day. It opens Scheduling on that day.
- **A request is cancelled** ("Time off cancelled") or **changed** ("Changed time off needs re-approval" if it had been approved).

Re-saving a day that was already marked off doesn't notify you again.

## Approving and declining

Requests are answered in the **Time off** panel on [Timesheets](/app/timesheets). That's for owners, admins, and managers with the Timesheets & time off permission. Pending requests are always listed first, whatever dates the timesheet is showing, followed by any time off that isn't over yet.

- **Approve** or **Decline** a pending request.
- **Cancel** approved time off to free the days on the schedule.
- The pencil edits dates, hours or reason and keeps the status you gave it. The bin deletes the request.

What approving does:

- **Employees** — the hours become paid time off in the payroll run for that period. If a run already covers those dates, approving is refused with the period named. Delete that pay period and create it again so the time off is included. Time off already inside a payroll run is locked the same way hours are.
- **Subcontractors** — approving marks them unavailable. No hours or pay attach.

With **PTO request decision email** on (**Settings → Payroll & timesheets**), the cleaner is emailed when you approve, decline or cancel.

## On the scheduler

- **Declared hours** show as a green dashed chip in the person's day cells on the week view, and beside their name in the day view's column headers. "Different hours" for a date replace the weekly hours that day. No chip means nothing was submitted: unknown, not unavailable.
- **Days off** (approved time off, or a day marked off) are striped on the board, with "Employee is off this day" on hover.
- **Pending requests** don't mark anything. Only approved time off counts as off.

## Jobs already booked on a day off

Nothing moves on its own. Approving time off, or a cleaner marking a day off, doesn't take anyone off the jobs they're already on. Sollos makes sure you know instead:

- The notification says how many jobs they're on in that window.
- **Needs you** on the dashboard flags tomorrow's jobs with anyone who's off: "Sam is off tomorrow".
- Saving a booking with someone who's off stops and asks: "Sam is off on Friday, Nov 20 (approved time off, or a day marked unavailable). Nothing was saved. Press Save again to book them anyway, or pick someone else."
- Dragging a job on the board onto their day off goes through, with "Moved — but Sam is off that day."
- The booking form's crew picker shows who's free and tucks the rest away with the reason, such as **Off that day**.

To cover a job, change its crew on the booking or drag it to someone else on the board (see [Bookings](help:bookings) and [Scheduling board](help:scheduling-board)). A cleaner can also take themselves off a single visit with **Call in sick** or **Can't make this shift** on the job (see [Manage shift](help:field-app#manage-shift)).

## Common questions

**Where do I approve time off?** On **Timesheets**, in the **Time off** panel. Pending requests are listed there no matter which dates the timesheet is showing. The notification for a new request opens that page.

**I approved time off. Why is my cleaner still on those jobs?** Approving doesn't unassign anyone. Reassign each job on the booking or the board. **Needs you** reminds you the day before for any job whose cleaner is off.

**Does a cleaner need my approval to mark a day off?** No. A day off from **My availability** takes effect straight away and you're notified. If you want to approve days off first, ask your team to use **Time off** instead.

**Can I set a cleaner's availability for them?** Not from the office. Cleaners set their own week and days off in the field app. You can still book them outside those hours. Availability is shown, not enforced, apart from the question the booking form asks for someone who's off.

**Why doesn't a cleaner's availability show on the scheduler?** They haven't saved any hours yet, or they switched days on without tapping **Save my hours**. An empty day means unknown, not unavailable.

**Approving says a payroll run already covers those dates.** The time off falls in a pay period you've already prepared. Delete that period on Payroll, approve the request, then create the period again so the paid hours are included.

**My cleaner is coming back early from approved time off.** They can cancel the request from **Time off** while any day is still ahead, which frees the remaining days. Then they file a new request for the days actually taken, if those need to be paid.
`,
};
