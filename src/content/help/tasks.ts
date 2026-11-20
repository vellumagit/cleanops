import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "tasks",
  title: "Tasks & reminders",
  blurb: "To-dos for the office and the team: due dates, push reminders, repeating tasks, and how cleaners see and tick off theirs.",
  section: "Scheduling & jobs",
  paths: ["/app/tasks", "/app/tasks/new", "/app/tasks/[id]/edit"],
  keywords: ["to-do","todo","reminder","task list","recurring task","assign a task","follow up","supplies reminder"],
  body: `
Tasks are the jobs that aren't cleans: pick up supplies, call a client back, renew the van insurance. Each one can have a due date, a push reminder, someone it belongs to, and a repeat.

Owners, admins and managers create, edit and delete tasks. Anyone a task is assigned to can tick it off — cleaners do it in the field app.

## Adding a task

**Tasks** in the sidebar, then **New task** (or [add one here](/app/tasks/new)):

- **Title** — required, e.g. "Pick up cleaning supplies".
- **Notes** — optional details or instructions.
- **Due date** — a date and time, in your company's time zone.
- **Remind me at** — a date and time for a push notification (see below).
- **Assign to** — anyone active in the company, or leave it **— Unassigned —**.
- **Recurrence** — **Daily**, **Weekly**, **Every 2 weeks**, **Monthly** or **Yearly**, or **— No recurrence —**.

Press **Create task**. When you assign a task to someone else, they get a *New task for you* notification straight away (assigning one to yourself doesn't). Changing who a task belongs to later notifies the new person; editing only the title or notes doesn't.

## The task list

The **Tasks & Reminders** page groups tasks into **Overdue**, **Today**, **Upcoming**, **No due date** and **Completed**, each with a count. Each row shows the due time, any reminder, the repeat and who it's assigned to.

- Tick the circle to mark a task complete; tick a completed one to reopen it.
- The pencil opens it to edit (**Save changes**); the bin deletes it after a confirmation. Deleting can't be undone.

Tasks with a due date also appear on the [Calendar](help:scheduling-board) when its **Tasks** source is on.

## Reminders

At the **Remind me at** time, Sollos sends a push notification — *Task reminder: [title]* — to the person the task is assigned to, or to every owner, admin and manager if nobody is. Reminders are sent on the hour, so one can arrive up to about an hour after the time you set. Each reminder goes once; a completed task isn't reminded, and changing the reminder time on an edit sets it to go again. Push notifications have to be turned on on each phone — see [Notifications](help:notifications).

## Repeating tasks

When you mark a repeating task complete, Sollos creates the next one: same title, notes, person and repeat, due one day, week, two weeks, month or year after the last due date. If it had a reminder, the new one is reminded the same length of time before it's due. A repeating task needs a due date for this to work.

## Tasks in the field app

Cleaners see the tasks assigned to them under **My tasks** — from the *N tasks from the office* banner on their **Today** screen, or **Profile → My tasks**. Each shows its notes, when it's due (overdue ones in red) and whether it repeats; they tap to tick it off. Tasks they finished in the last week are listed under **Done in the last week**, and can be unticked there. Cleaners can't create or edit tasks.

Low stock can create tasks too: when an inventory item assigned to someone drops to its reorder level, they're given a *Restock* task. See [Inventory](help:inventory).

## Common questions

**Why didn't my cleaner get a reminder?** Reminders are push notifications, so they need push turned on on that phone, and they go out on the hour after the reminder time. A task with nobody assigned reminds the office instead.

**My repeating task didn't come back.** The next one is only made when this one is marked complete, and only if it has a due date.

**Can cleaners add their own tasks?** No — they see and tick off tasks the office assigns them.

**Who gets told when I assign a task?** The person you assign it to, with a notification linking to their tasks. Nobody is told when you assign one to yourself.

**Can I see tasks on the calendar?** Yes — tasks with a due date show on the Calendar page when the **Tasks** source is on.
`,
};
