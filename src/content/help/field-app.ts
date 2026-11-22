import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "field-app",
  title: "The field app: a cleaner's day",
  blurb: "What your cleaners see on their phones: getting in, today's jobs, accepting shifts, the job screen, photos, checklists, tasks, chat, training and their profile.",
  section: "The field app",
  paths: [
    "/field",
    "/field/jobs",
    "/field/jobs/[id]",
    "/field/tasks",
    "/field/chat",
    "/field/feed",
    "/field/training",
    "/field/training/[moduleId]",
    "/field/profile",
    "/field/profile/security",
  ],
  keywords: [
    "cleaner app",
    "employee app",
    "crew app",
    "mobile app",
    "phone app",
    "install",
    "home screen",
    "accept shift",
    "confirm shift",
    "decline shift",
    "call in sick",
    "lockbox",
    "door code",
    "access instructions",
    "before and after photos",
    "checklist",
    "two-factor",
    "invite link",
  ],
  body: `
The field app is what your cleaners use on their phones: the day's jobs, the clock, notes and access instructions, checklists, photos, chat. This guide walks through it the way a cleaner meets it, so you can forward it to your team as it is.

Anyone on your team can open the field app, including owners, admins and managers. Office users see a **Dashboard** button in its header that takes them back to the office.

## Getting in

1. You invite the person from **Employees** (owners and admins; see [Employees](help:employees)). The invite is emailed to them, and you can also copy the link and text it. The link is personal, works once, and expires after 14 days.
2. The cleaner opens the link and sees **Join** and your company's name. They type **Your name** and a **Password** (at least 8 characters) and tap **Create account & join**. The email address is fixed to the one you invited.
3. If they already have a Sollos account under that email, the page says so and shows **Sign in to accept**. They sign in with the password they already have, and the invite is accepted.
4. Cleaners land on the **Today** screen.

If the link doesn't work, the page says why: **Invitation expired** (send a new invite), **Already joined** (they just need to sign in), or **Link not valid** (the link was cut short; send the full link again). Someone signed in under a different email is told which address the invite was for and asked to sign out and open the link again.

After that, they sign in on the Sollos sign-in page with their email and password. **Forgot password?** on that page resets it.

### Put it on the home screen

Sollos installs like an app, with no app store involved.

- **Android** — an **Install Sollos** banner appears at the top of the field app. Tap **Install app**.
- **iPhone** — open the field app in Safari, tap the Share button, then **Add to Home Screen**. In any other iPhone browser the banner says to open the page in Safari first.

Closing the banner hides it for a week. On an iPhone, installing is more than a shortcut: notifications only work from the home-screen icon.

### Turn on notifications

A blue **Enable notifications** banner offers alerts for new jobs, messages and schedule changes. Tap **Turn on** and allow it when the phone asks. It can also be done later from **Profile → Push notifications**. Each phone is set up separately. If notifications were blocked once, the profile shows the exact steps for that phone instead of a button that does nothing.

## The tabs along the bottom

**Today**, **Shifts**, **Clock**, **Feed**, **Chat** and **Profile**. Chat shows a number when there are unread messages. Feed only appears when you've turned on **Show team feed** in **Settings → Client messages**. The header shows your logo, the cleaner's name, and **Sign out**.

Tasks, training, hours, pay, availability and time off are all reached from **Profile**.

## Today

**Today** lists jobs scheduled for today, any job already in progress, and any earlier job that was never completed, so an overdue visit can't slip off the screen. Jobs are grouped under their date, and a shift still waiting for the cleaner's OK goes to the top.

Each card leads with the day and time, then the client's name and status, the length and service, the address, and a shortened view of the job's note and the client's standing note. When the office has given them tasks, a line at the top says how many (**2 tasks from the office**) and opens them.

What a card can say:

- **Confirm for today** — the shift hasn't been accepted yet. Open it to answer.
- **Open to start** — the job starts within four hours. Opening the card is where the clock starts. Tapping the card itself never clocks anyone in.
- **On the clock 1h 20m** — their clock is running on this job. It turns amber once they're past the job's time ("25m over"), or after ten hours.
- **Crew has started · tap I'm here when you arrive** — a crewmate is already clocked in.
- **Job still open · you're not on the clock · open to clock back in** — their clock was stopped but the job is still going.
- **I'm done** — shown on the card while they're clocked in. It takes two taps (**Tap to confirm**) so a stray tap can't finish the job.

When there's nothing, Today says so and points to the **Shifts** tab.

## Shifts

**Shifts** (titled **Upcoming shifts**) lists assigned jobs on the days ahead. A banner counts the ones that need confirming. It only shows work already assigned to them. Shifts you offer out arrive as a link instead (see [Shift offers](help:shift-offers)).

## Accepting a shift

Every assigned cleaner confirms each shift. Opening an unanswered one shows the question first, with the time, estimated length and address: **Can you make this shift Sat Sep 26 at 3:00 PM?**

- **Yes, I'll be there Sat Sep 26 at 3:00 PM** (or **Yes, I'm on this today at 3:00 PM**) confirms it.
- **Can't make it** asks once more (**Yes, decline** or **Keep shift**), then takes them off the job.

What happens next:

- Confirming one visit of a recurring client confirms all their upcoming visits for that client at once.
- Your owners, admins and managers get an email either way. A decline also sends them a notification saying the shift needs reassigning. If the cleaner was the lead, another crew member becomes lead. If nobody is left, the job shows as unassigned.
- Until a shift is accepted, **I'm here** doesn't appear. The exception is a team job a crewmate has already started: then starting it counts as accepting.
- With the **Shift still unconfirmed** automation on, an unanswered shift is chased the day before and again two hours before. At the second reminder you're told too.

## The job screen

Opening a job shows, from top to bottom:

- **The clock**: **I'm here**, **Stop my clock — job stays open**, **I'm done**, and the running time. How these work is in [Clocking in, hours & pay](help:field-time-and-pay).
- **The day, time and client**, the property's name when the client has more than one place, the service and the status.
- **Time and estimated length.** If your company divides team hours, it shows their share ("your share of a 6h job, split evenly between 2 cleaners").
- **Crew times — yours is highlighted**, when crew members arrive at different times.
- **The address**, with **Open in Maps**.
- **Getting in** — the access instructions saved on the client's property (door codes, lockbox, alarm). It sits right under the address because that's what someone at the door needs.
- **The client's phone number.** Tap it to call.
- **This job** — the office's note for this visit.
- **From the client, for today** — an amber box with a note the client left for this visit from their portal ("skip the bathroom this week").
- **Client notes** — the standing note on the client's profile, such as pets or the buzzer. It's read live, so editing the profile updates every job at once.
- **Working with** — everyone on the shift, with **Lead** and **You** tags.
- **Photos**, **Home photos & videos**, the **Checklist**, and **Manage shift**.

On an unanswered shift, photos, the checklist and Manage shift stay hidden until it's accepted. Home photos still show, because seeing the place helps decide. A cancelled job opens to "This job was cancelled." A job assigned to someone else opens to "This job isn't assigned to you."

### Photos

1. Tap **Before**, **After**, or the extra-photo button.
2. Tap **Take photo** to use the camera, or **From gallery** to pick photos already on the phone (several at once is fine).

Photos are shrunk on the phone before they upload, so they go through on weak signal. JPG, PNG, HEIC and WebP all work. They're grouped under Before, After and Other, and the office sees them on the booking. A photo can be deleted by whoever added it, or by a manager.

### Home photos & videos

These are pictures and videos of the home itself, added by the office or sent in by the client. Cleaners can look at them but not add or remove them. The section only appears when there's something in it.

### Checklist

The checklist is grouped into **Before job**, **During job** and **After job**, with any headings the template has. Tap the circle beside an item to tick it. Ticks save straight away and can be undone, and the count shows progress ("3/12 complete"). **Required** marks items the template flags as required. It's a label only: the app doesn't stop **I'm done** while a required item is unticked. The office sets up checklists (see [Checklists](help:checklists)).

### Manage shift

At the bottom of an accepted job they haven't clocked into yet:

- **Call in sick** — one confirmation (**Yes, I'm sick**).
- **Can't make this shift** — a short reason is required, then **Cancel this shift**.
- **Ask to stop the recurring client** (recurring jobs only) — a reason, then **Cancel + send request**. Their later visits for that client stay on their schedule until a manager reassigns them. The request shows in the **Needs coverage** panel on **Scheduling**.

All three take the cleaner off this one visit and alert your owners, admins and managers with a notification and an email so it can be covered. The visit itself isn't cancelled for the client. Once someone has clocked in on a job, these options disappear: they finish with **I'm done** and talk to the office.

## When someone is late

Two automations watch for jobs nobody started. Both are off until you switch them on in **Settings → Client messages**.

- **Nobody clocked in yet** — 15 minutes after a job's start time, each confirmed cleaner who hasn't clocked in gets a notification: "You're not clocked in". On a crew with different arrival times, each person is measured from their own start. You aren't told at this point, since fifteen minutes late isn't news yet.
- **Job finished with no clock-in** — 30 minutes after a job's whole window has passed with someone assigned and no clock-in, you get one alert, by notification and email. It comes before the job is completed and billed, so you can confirm or cancel it first.

The dashboard's **Needs you** list also shows jobs that should have started and haven't (see [Dashboard](help:dashboard)). Forgotten clock-outs are covered in [Clocking in, hours & pay](help:field-time-and-pay).

## Tasks

**My tasks** opens from the line on **Today** or from **Profile → My tasks**, which shows a count ("2 to do"). Each task shows its notes, its due date (in red when it's urgent) and how often it repeats. Tap the box to mark it done. Ticking off a repeating task that has a due date creates the next one. **Done in the last week** lists recent ones, which can be unticked. A newly assigned task sends a "New task for you" notification. You assign tasks from **Tasks** in the office (see [Tasks](help:tasks)).

## Chat and Feed

**Chat** is for direct messages with any active teammate (**Start a new DM**, then **Pick a teammate…**) and the team-wide #general channel. Photos can be sent from the camera or the gallery. See [Team chat & feed](help:team-comms).

**Feed** shows updates from your team. Cleaners read it. Only owners, admins and managers post, pin or delete. It appears only when **Show team feed** is on.

## Training

**Profile → Training modules** lists the modules assigned to them, each with steps done and a progress bar. Opening one shows numbered steps with text and, where you added them, a picture or a video link. Tapping the circle beside a step marks it done. When every step is ticked, the module counts as complete. Modules you've set to be assigned on joining are given to a new team member automatically when they accept the invite. See [Training](help:training).

## Profile

- **Who you are** — name, role and company, with **Full name** and **Phone** fields and **Save changes**.
- **My work** — **My pay**, **My hours**, **My availability**, **Time off** (with a "pending" count), **My tasks** and **Training modules**.
- **Notifications & calendar** — the **Push notifications** switch ("Notifications on (tap to disable)") and **Google Calendar**. **Connect Google Calendar** puts their assigned jobs on their own calendar and keeps the events updated as the schedule changes. Once connected, the options are **Re-sync upcoming jobs**, **Switch account** and **Disconnect**. If they didn't allow calendar access on Google's screen, it asks them to **Reconnect & allow Calendar**. Office users can also choose between only their own jobs and the whole team's.
- **Account & privacy** — **Security**, plus a plain note that their location is recorded when they clock in or out of a job, seen only by their employer.

### Security

**Profile → Security** adds a second sign-in step with an authenticator app. It's off unless the person turns it on. They tap **Enable multi-factor authentication**, scan the QR code with their authenticator app, enter the 6-digit code and tap **Confirm**. From then on, signing in asks for a code. **Remove** takes it off again. See [Account & security](help:account-and-security).

## Common questions

**My cleaner says the invite link doesn't work.** The page tells them why. An expired link (older than 14 days) or one that's already been used needs a fresh invite from Employees. If it says **Link not valid**, the link was probably cut short in a text message, so send the full link again.

**Why can't my cleaner see the I'm here button?** Usually one of three things. The shift hasn't been accepted yet (the card says **Confirm for today**). The job is more than four hours away (the job screen names its date). Or they opened a different day's card for the same client. The card for today is under today's date on **Today**.

**Will my cleaners get notifications on an iPhone?** Only from the home-screen icon, not from a Safari tab. Have them add Sollos to the home screen from Safari, open it from the new icon, and tap **Turn on**.

**Can cleaners see client prices or invoices?** Nothing on the field app's job screens shows what the client pays. Cleaners see the time, address, notes, access instructions, crew, photos and checklist.

**What happens when a cleaner calls in sick?** They come off that one visit and you get a notification and an email naming the client and time, so you can reassign it. The booking stays on your schedule. If they were the only person on it, it shows as unassigned.

**A cleaner accepted one visit. Why do all their visits for that client show as accepted?** Confirming a recurring visit confirms all of that cleaner's upcoming visits for the same client in one go. It's built that way so they vouch for the client once instead of every week.

**Do I need the field app myself?** No, but you can use it. Owners, admins and managers can open the field app to see what the crew sees, and its **Dashboard** button takes you back.
`,
};
