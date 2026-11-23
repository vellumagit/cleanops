import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "client-portal",
  title: "The client portal",
  blurb: "How clients get in with just their email, inviting them, what each portal page lets them do, and what you see when they use it.",
  section: "Website & portal",
  paths: [
    "/app/settings/online-booking",
    "/client/(portal)",
    "/client/(portal)/jobs",
    "/client/(portal)/jobs/[id]",
    "/client/(portal)/invoices",
    "/client/(portal)/request",
  ],
  keywords: ["customer login", "self-service", "client app", "client account", "portal invite", "skip a visit", "pay online", "client sign in", "booking page", "online booking", "booking link", "request a clean"],
  body: `
The client portal is the client's own sign-in to Sollos. They see their visits and invoices, leave a note for the cleaner, skip a visit, pay, and ask for a new booking. It saves you phone calls: the small things reach you as tidy requests instead of interruptions.

## How a client gets in

Any client with an email address on file can get in, with no setup and no password:

1. They go to **sollos3.com/client/login** and type the email you have for them.
2. Sollos emails them a message from your company with one button, **Open my cleans**.
3. They press it and they're in. The button works once, for an hour. Next time they ask for a new one the same way.

If the email they type isn't the one on their profile, nothing arrives. That is on purpose: the page gives the same answer either way, so nobody can use it to find out who your clients are. If a client says no email came, check the address on their profile.

## Your booking page

Your own page for clients, on a link you choose, such as sollos3.com/book/your-company. It carries your logo, colour and words, and has two big buttons: **Ask for a clean** and **See my cleans**. Put the link on your website, your cards and your messages.

You have no page until you make one. Owners and admins set it up in **Settings → Clients → Online booking**:

1. **Choose your link** and press **Make my page, as a draft**. Your company's name is suggested; change it if you like.
2. Write a **Headline** and **A few words about you**.
3. Under **Services on your page**, tick the services a visitor should see. For each, choose **Show the price**, **Show as "From $X"**, or **Don't show a price**. Prices come from Settings → Services.
4. Press **Save**, then **Preview** to look at it. A draft opens only for you and your office. To anyone else the link shows "not found".
5. Press **Publish** when you're happy.

**Take it down** hides the page again and keeps everything you set up. Changing the **Link name** changes your link, and the old one stops working, so update it anywhere you shared it.

### When you can be booked

Below the page's own settings, **When you can be booked** sets the times your page can offer. It feeds the preview underneath, so you can check it against your calendar before you let anyone pick a time.

- **Can a visitor pick a time?** Starts at **No, requests only**. See *Letting visitors pick a time* below.
- **Opening hours**: tick the days you take bookings and set the hours. A new page has none saved, so it is closed every day until you press **Save hours and people**. Weekdays nine to five are filled in as a start.
- **Notice you need**: in hours. 24 means nobody can book for sooner than this time tomorrow.
- **How far ahead**: in days.
- **Gap between jobs**: minutes kept clear before and after a cleaner's other jobs, for travel.
- **Changes and cancellations**: in hours, 48 to start. Up to this long before a visit a client can cancel it themselves (and move it, if visitors can book straight away). Closer than this, a cancel comes to your Requests page first.
- **Start times every**: 15 minutes, 30 minutes, or an hour.
- **Who takes online bookings**: only the people you tick are ever offered. Nobody is ticked to start with.

Each service in **Services on your page** also shows its length and takes a number of cleaners. The length comes from Settings → Services and is the hours for one person. If your crews share a job's hours, a two-hour job for two cleaners is offered as one hour on site.

**What a visitor would see** lists the open start times for one service over seven days. Pick the **Service** and a **From** date and press **Show**. A time is listed when enough ticked people are free: not on approved time off, inside the hours they gave, and not on another job (with your gap either side). Hover a time to see who is free. A statutory holiday is closed if you have a holiday region set. A day with no times says why, such as **Closed.**, **Too soon: inside the notice you ask for.** or **No open times: nobody is free.**

### Letting visitors pick a time

**Can a visitor pick a time?** has three settings:

- **No, requests only**: your page has **Ask for a clean** and nothing else. This is where every page starts.
- **Yes, and I confirm each one**: a visitor picks a time and the visit is saved as **Pending**. The time is held, so nobody else can take it, and the visitor is emailed that it isn't confirmed yet.
- **Yes, booked straight away**: the visit is saved as **Confirmed** and the visitor gets a confirmation.

With either "Yes", your page gains a **Book a clean** button. It asks one thing a screen: what they'd like, which day, what time, then the address and their name and email. Only services that are ticked to show and have a length can be booked this way. If nobody is ticked to take online bookings, or no hours are saved, there are no times to pick.

What a booking does:

- It is an ordinary visit on your calendar, marked **Booked online**, with the service's length and price from Settings → Services.
- It is given to the ticked cleaner (or cleaners) with the fewest jobs that day. You can change the crew like any other visit, and they are notified the usual way.
- Owners, admins and managers get a **Booked online** notification, or **Online booking to confirm** when you confirm each one. You can switch these off under the Schedule group in your [notification choices](/app/notifications/choices).
- Someone new is added to your **Leads** and becomes a client once the visit is confirmed. If the email is already on a client's profile, the visit goes on that client's record. The page tells the visitor nothing about that client.
- What the visitor typed under "Anything we should know?" shows to the crew as the client's note for that visit.
- A confirmed visitor always gets a confirmation email with a button to see or change the visit: your own confirmation if you have it switched on, a plain one from your company if you don't.

**To confirm a held booking**, open it and set its status to **Confirmed**. The visitor gets the confirmation then. **To decline it**, set it to **Cancelled**, which gives the time back.

If two people press the same time at the same moment, one gets it and the other is shown the times still open.

**Ask for a clean** is a short form: what they'd like, a day and time of day that suit them, the address, and their name, email and phone. It asks; it doesn't book. When someone sends it:

- It lands on your [Requests](/app/bookings/requests) page, and owners, admins, and managers get a "New booking request" notification. The owner is emailed too.
- Someone new is added to your **Leads**. If the email is already on a client's profile, the request goes on that client's record.
- The visitor gets a short email from your company saying the request arrived and that nothing is booked yet.

## Inviting a client

An invite is a way to send a client the link yourself. It is not needed for them to get in. Owners and admins invite clients from the client's profile:

1. Make sure the client has an email address on file.
2. On their profile, press **Invite to portal**. The same button is on the **Client portal** card on their edit page.
3. Sollos emails them an **Open my cleans** link and shows you the link in a **Portal invite sent** window, with **Copy**, so you can also text it to them. They open it, press one button, and they're in.

The link works once, for 14 days. It's only shown in that window. Sending the invite again makes a new link and switches the old one off. The profile button tells you where things stand:

- **Invite pending**: sent, not used yet. Press it to resend.
- **Resend invite**: the invite expired.
- **Portal active**: the client has been in at least once.

To try the link yourself, open it in a private browser window. In your normal window you're signed in as staff, and the link will say so.

## The sign-in page

On sollos3.com/client/login:

- **Email me a link** is the one main button. It is all most clients ever need.
- **I have a password** is for clients who chose a password before November 2026. It switches to email and password, with **I forgot my password** to set a new one.

The Sollos front page and the staff sign-in page both point clients to it, under **Here to see your cleaner?**

One login opens one client record. If the same email is on file with two cleaning companies that use Sollos, the client sees the one that has had them longest.

Archiving a client locks them out. Restoring them lets them back in, with nothing more to do.

## Home

The home screen greets the client by first name and shows:

- **Upcoming cleans**: their next three confirmed visits. Each one opens the visit.
- **To pay**: up to three invoices still owing, each with a **Pay now** button.
- A reminder that every finished visit has a link to leave a review.

The tabs along the bottom are **Home**, **My cleans**, **New clean**, and **Invoices**. The top of every page shows your company's name, and the bottom shows your phone number (from Settings, Email & contact) for a client who would rather call.

> Clients never see **Pending** visits. Pending means you've pencilled a job in but haven't committed to it, such as the placeholder from an approved estimate. A visit appears in the portal once it's confirmed.

## My cleans

**My cleans** lists **Upcoming** and **Past** visits with the date and time, service, length, address, and status. Cancelled visits show as cancelled. A finished visit has a **Leave a review** link. Once the client has left a review, their stars show instead (see [Reviews](help:reviews)).

## A visit

Tapping a visit shows the service, status, date and time, roughly how long it takes, the address, and who's coming (**Your cleaner** or **Your cleaners**). Visits that aren't cancelled have **Add to Google Calendar** and **Apple / Outlook (.ics)** links.

For a confirmed or pending visit that hasn't started, the client has three buttons.

**Leave a note for this visit.** For example, "Please skip the bathroom this week, it's just been redone." The note:

- Goes to the assigned cleaner's job screen in the field app as a highlighted card, and they get a notification.
- Shows on the booking as **Client note for this visit**, and owners, admins, and managers get a notification.
- Applies to this visit only. It never changes the booking's standing notes.
- Arrives already marked done. It's information, not a request waiting on you.

Notes can be up to 1,000 characters. A note that looks like a card number is refused.

**Ask to move this visit.** The client writes when would suit them better. Nothing changes on the schedule:

- It lands on your [Requests](/app/bookings/requests) page as an open question, with their words.
- Owners, admins, and managers get a notification and an email.
- The crew is not told. The visit goes ahead as booked until you move it.

**Move to another time.** Shown instead of "Ask to move this visit" when your booking page is set to **Yes, booked straight away** (see *Letting visitors pick a time*). The client picks a day and a time and presses **Yes, move my clean**:

- The times offered are the ones the visit's own crew is free, inside your opening hours, with your gap either side of their other jobs. The same people stay on the job.
- The visit moves at once. Owners, admins and managers get a "moved a visit" notification, the crew gets the usual rescheduled notice, and the calendars follow.
- It is on the booking's record as *Moved their visit from … to …*.
- It isn't offered when the visit is closer than your notice period, has nobody assigned, has people on their own split times, or has already been moved three times by the client. The page then says to ask or call.

**Skip a visit.** What happens depends on how soon the visit is. The 48 hours below is the starting notice period; you can change it under **Changes and cancellations** in **Settings → Clients → Online booking**:

- **48 hours or more away**: the button reads **Skip this cleaning**. The visit is cancelled straight away. You get a notification, and so does the assigned crew. It comes off the calendars, and the rest of a recurring schedule carries on as normal.
- **Less than 48 hours away**: the button reads **Ask to skip**. Nothing is cancelled yet. The request goes to your [Requests](/app/bookings/requests) page for you to approve or decline, and owners, admins, and managers get a notification and an email. See [Requests](help:requests).

Under **What you've told us**, the client sees their past notes and skip requests. A skip shows as **Cancelled** (done automatically), **Sorted** (you handled it), or **Waiting on the office**.

Once a visit has started, finished, or been cancelled, the buttons are gone and the client sees why: for example, "Your cleaner has already started. Call the office if you need to change something now."

## The button in booking emails

Every booking confirmation, day-before reminder, and reschedule email has a **See or change this visit** button. It opens that one visit with no sign-in: when it is, what it is, where, and who's coming, under your company's name. From there the client has the same three choices as above: leave a note, ask to move it, or cancel it.

- The link opens that visit and nothing else. To see everything, the client signs in with their email.
- It stops working a week after the visit, and straight away if you archive the client.
- Texts don't carry the link, only emails.

## Ask for a clean

On the **New clean** tab, the client fills in:

- **What do you need cleaned?** (required). It starts filled in with the service from their last booking.
- **Preferred date** and **Preferred time**: **Flexible**, **Morning**, **Afternoon**, or **Evening**.
- **Address**: leave it blank to use the one on file.
- **Anything we should know?**

They press **Send request** and see **Request received**. On your side:

- The request lands on your Requests page, and owners, admins, and managers get a "New booking request" notification.
- The owner is emailed too.
- **Create booking** on the request opens a booking with everything they said filled in. Saving it marks the request scheduled.

A client can send five requests an hour.

## Invoices and paying

**My invoices** lists invoices you've sent, with the amount, number, date, due date, and status. Drafts are never shown, so a client doesn't see a bill before you've reviewed it. Invoices still owing (sent, overdue, or partly paid) have a **Pay now** button. Paid invoices have a link to view them.

**Pay now** opens the invoice's own page. If you've connected Stripe or Square, the client sees **Pay with card**. If not, they see your payment instructions from [Settings → Getting paid](/app/settings/payment-methods). A card payment is recorded against the invoice automatically. See [Getting paid](help:getting-paid).

## The phone works too

A client who calls instead of using the portal loses nothing. On the booking, the office can type a **client note for this visit**. The cleaner sees the same highlighted card, and nobody needs to know whether it was typed or phoned in.

> Client notes are kept apart from the booking's own notes on purpose. A booking note saved "for this and future visits" becomes a standing instruction for the whole series. A client's "just this week" must never do that, and through this channel it can't.

## Common questions

**My client says the invite link doesn't work.** Links work once and expire after 14 days. Press **Resend invite** (or **Invite pending**) on their profile and use the new link. Sending again switches the old link off.

**My client forgot their password.** On the client sign-in page they can press **Email me a sign-in link**, or choose **I have a password** and then **Forgot your password?**.

**Why can't my client see a booking I made?** It's still **Pending**. Clients only see a visit once it's confirmed.

**A client skipped a visit. Do I need to do anything?** If it was 48 hours or more away, no: it's already cancelled and you've been told. If it was closer, the request is waiting on your Requests page for you to approve or decline.

**Can a client cancel their whole recurring schedule from the portal?** No. They can only skip one visit at a time. The rest of the schedule carries on.

**Why does the client see an invoice but no Pay with card button?** You haven't connected Stripe or Square, so the page shows your payment instructions instead. See [Integrations](help:integrations).

**Does the office know when a client signs up?** There's no notification, but their profile shows **Portal active** once they've set up their account.
`,
};
