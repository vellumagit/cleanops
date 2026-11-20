import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "requests",
  title: "Requests",
  blurb: "The inbox for what clients ask for: portal booking requests, skip requests, website inquiries and estimate requests — and how each one is answered.",
  section: "Scheduling & jobs",
  paths: ["/app/bookings/requests"],
  keywords: ["inbox","booking request","skip request","inquiry","enquiry","contact form","estimate request","portal request","decline","pending requests"],
  body: `
**Requests** is the inbox for things clients ask of you: a new visit asked for from their portal, a skip that came in too late to apply on its own, and messages from your website forms. Each one has buttons to answer it right there, and answering it takes it off the badge.

Owners, admins and managers see Requests in the sidebar (and as a tab on a phone). The number beside it counts pending booking requests plus open inquiries, notes and skip requests.

## What lands here

The page has up to three parts, top to bottom:

1. **Inquiries & notes** — messages from your website forms (the contact form and the estimate-request form) and notes from clients that are waiting on an answer.
2. **A client wants to skip a visit** — skip requests made in the client portal less than 48 hours before the visit, marked *Too close to cancel automatically*.
3. **Booking requests** — visits clients have asked for from their portal, with **Pending** and **Resolved** tabs.

Sections with nothing in them don't show.

## Inquiries & notes

Each one shows who sent it (click the name to open their client record), when, their contact details, and the message. Someone new who writes in through a website form is also added as a lead, and an estimate request creates a draft estimate as well — see [Website forms](help:website-forms) and [Leads & clients](help:leads-and-clients).

Press **Resolve** once you've answered and there's nothing else to do. You often won't need to: converting the lead to a client, or marking it lost, resolves their inquiries automatically. Resolving sends nothing to the client.

## Skip requests

A client can skip a visit from their portal. If the visit is 48 hours or more away, it's cancelled straight away and you're told — nothing lands here. Closer in, the crew is already committed, so the client's request waits for you:

- **Cancel the visit** — cancels it (the series, if there is one, carries on) and pushes the crew: *A job was cancelled — the client asked to skip this visit and the office approved it.* If the visit is already under way or finished it isn't cancelled, and the page says so.
- **Keep it** — the visit stays as booked.

Either way the request leaves the list. Neither button sends the client a message, so let them know your answer. Click the client's name to open the visit itself. The booking page also shows the request, as *Client asked to skip — needs your call*.

## Booking requests

A booking request shows the client, the service they asked for, their **Preferred date** and **Preferred time**, the address, their notes, their email and phone (tap to email or call), and when they sent it. On a pending one:

- **Create booking** — opens the new-booking form with the client, their preferred date (and a start time matching their time window), the address and their notes filled in. Check the service, price, crew and time, then save: creating the booking marks the request *Scheduled* automatically. The client gets the normal booking confirmation, if your confirmation automations are on — see [Bookings](help:bookings).
- **Mark resolved** — for a request you've dealt with some other way (you booked it already, or sorted it by phone). It moves to Resolved as *Scheduled*. Nothing is sent.
- **Decline** — moves it to Resolved as *Declined* and emails the client (if they have an email address) that you can't take the request as submitted, inviting them to send different dates or reply.

The **Resolved** tab lists scheduled, declined and cancelled requests, with when each was resolved. **Reopen** puts one back in Pending.

When there are pending booking requests, a **Requests (N)** button also appears at the top of the bookings list.

## Common questions

**Why is the Requests badge still showing a number?** It counts pending booking requests and open inquiries, notes and skip requests. Something in one of the three parts is still waiting — scroll the whole page. Pending booking requests only clear when you create the booking, mark them resolved, or decline them.

**Does the client know I declined their request?** Yes, if they have an email address: **Decline** emails them a short note. **Mark resolved** sends nothing.

**Does the client hear back when I answer a skip request?** No — neither **Cancel the visit** nor **Keep it** messages the client. Only the crew is told, and only when the visit is cancelled.

**Why did a client's skip cancel the visit without asking me?** Skips made 48 hours or more before the visit apply on their own; you're notified, and the booking page shows *Client skipped this visit*. Only later skips come here for a decision.

**I created a booking from a request but it's still pending.** It's marked scheduled when the booking is created from that request's **Create booking** button. If you made the booking another way, press **Mark resolved**.

**Where do website contact-form messages go?** To **Inquiries & notes** on this page, and a sender you didn't know yet becomes a lead. See [Website forms](help:website-forms).
`,
};
