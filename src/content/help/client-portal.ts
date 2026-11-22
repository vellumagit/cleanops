import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "client-portal",
  title: "The client portal",
  blurb: "Inviting clients, how they sign in, what each portal page lets them do, and what you see when they use it.",
  section: "Website & portal",
  paths: [
    "/client/(portal)",
    "/client/(portal)/jobs",
    "/client/(portal)/jobs/[id]",
    "/client/(portal)/invoices",
    "/client/(portal)/request",
  ],
  keywords: ["customer login", "self-service", "client app", "client account", "portal invite", "skip a visit", "pay online", "client sign in"],
  body: `
The client portal is the client's own sign-in to Sollos. They see their visits and invoices, leave a note for the cleaner, skip a visit, pay, and ask for a new booking. It saves you phone calls: the small things reach you as tidy requests instead of interruptions.

## Inviting a client

Owners and admins invite clients from the client's profile:

1. Make sure the client has an email address on file.
2. On their profile, press **Invite to portal**. The same button is on the **Client portal** card on their edit page.
3. Sollos emails them a **Set up your account** link and shows you the link in a **Portal invite sent** window, with **Copy**, so you can also text it to them.

The link works once, for 14 days. It's only shown in that window. Sending the invite again makes a new link and switches the old one off. The profile button tells you where things stand:

- **Invite pending**: sent, not used yet. Press it to resend.
- **Resend invite**: the invite expired.
- **Portal active**: the client has set up their account.

To try the link yourself, open it in a private browser window. In your normal window you're signed in as staff, and the link will say so.

## How a client signs in

**The first time**, the client opens the invite link and picks a password (at least 8 characters). If their email already has a Sollos login, they're asked to sign in with it instead. Opening the invite link while signed in with that same email connects the login to their portal. One login can only be the portal for one client.

**After that**, they sign in at the client sign-in page, sollos3.com/client/login. They can also use the main Sollos sign-in page, which recognizes a client and sends them to their portal. On the client sign-in page:

- **Email me a sign-in link** is the default. The emailed link signs them in, and it expires in an hour. This suits clients who don't remember passwords.
- **I have a password** switches to email and password.
- **Forgot your password?** emails a link to set a new password.

Archiving a client locks their portal sign-in. Restoring them unlocks it, with no new invite needed.

## Home

The home screen greets the client by first name and shows:

- **Upcoming cleans**: their next three confirmed visits. Each one opens the visit.
- **Outstanding invoices**: up to three invoices still owing, each with a **Pay now** button.
- A reminder that every finished visit has a link to leave a review.

The tabs along the bottom are **Home**, **Jobs**, **Request**, and **Invoices**.

> Clients never see **Pending** visits. Pending means you've pencilled a job in but haven't committed to it, such as the placeholder from an approved estimate. A visit appears in the portal once it's confirmed.

## Jobs

**My cleaning jobs** lists **Upcoming** and **Past** visits with the date and time, service, length, address, and status. Cancelled visits show as cancelled. A finished visit has a **Leave a review** link. Once the client has left a review, their stars show instead (see [Reviews](help:reviews)).

## A visit

Tapping a visit shows the service, status, date and time, roughly how long it takes, the address, and who's coming (**Your cleaner** or **Your cleaners**). Visits that aren't cancelled have **Add to Google Calendar** and **Apple / Outlook (.ics)** links.

For a confirmed or pending visit that hasn't started, the client has two buttons.

**Leave a note for this visit.** For example, "Please skip the bathroom this week, it's just been redone." The note:

- Goes to the assigned cleaner's job screen in the field app as a highlighted card, and they get a notification.
- Shows on the booking as **Client note for this visit**, and owners, admins, and managers get a notification.
- Applies to this visit only. It never changes the booking's standing notes.
- Arrives already marked done. It's information, not a request waiting on you.

Notes can be up to 1,000 characters. A note that looks like a card number is refused.

**Skip a visit.** What happens depends on how soon the visit is:

- **48 hours or more away**: the button reads **Skip this cleaning**. The visit is cancelled straight away. You get a notification, and so does the assigned crew. It comes off the calendars, and the rest of a recurring schedule carries on as normal.
- **Less than 48 hours away**: the button reads **Ask to skip**. Nothing is cancelled yet. The request goes to your [Requests](/app/bookings/requests) page for you to approve or decline, and owners, admins, and managers get a notification and an email. See [Requests](help:requests).

Under **What you've told us**, the client sees their past notes and skip requests. A skip shows as **Cancelled** (done automatically), **Sorted** (you handled it), or **Waiting on the office**.

Once a visit has started, finished, or been cancelled, the buttons are gone and the client sees why: for example, "Your cleaner has already started. Call the office if you need to change something now."

## Request a booking

On the **Request** tab, the client fills in:

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
