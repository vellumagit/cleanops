import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "shift-offers",
  title: "Offering shifts",
  blurb: "Texting an open shift to your subcontractors and on-call cleaners, several spots, replacing someone who's out, claiming, and unfilled-shift alerts.",
  section: "Scheduling & jobs",
  paths: ["/app/bookings/[id]/offer", "/app/freelancers/offers", "/app/freelancers/offers/[id]"],
  keywords: ["offer shift","open shift","coverage","cover","claim","sick","call out","subcontractor","on-call","freelancer","broadcast","fill a shift","unfilled"],
  body: `
When a job needs someone — a cleaner called in sick, or nobody was ever put on it — you can text the shift to a list of people and let the first to claim it take it. Each person gets their own link; claiming takes one tap and no login.

Offers go to two groups:

- **Your subcontractors** — people on your own team set up as subcontractors under Employees. Claiming puts them on the job's crew, and they're paid their usual rate from clocked hours.
- **The on-call pool** — outside cleaners you keep on a list to call on (see [On-call pool](help:on-call-pool)). They earn the flat amount you set on the offer, once the job completes.

Your regular employees are never sent offers: they're scheduled, not offered.

Offering shifts is for owners, admins and managers who have the **On-call pool & subcontractor pay** area switched on (see [Roles & permissions](help:roles-and-permissions)).

## Sending an offer

Open **Offer shift** from the booking page, from **Offer** beside an unassigned job on the bookings list, or from the scheduler's quick view. The page shows a summary of the shift and:

- **Replacing** — shown when the job already has a crew. Pick who's out, and whoever claims first takes their spot — same times on the job — and the person who was out comes off it and is told (*You're off this shift*). This won't happen if the job has already started or they've clocked in. Leave it on **Nobody — adding someone** to add an extra person instead.
- **On-call pay ($)** — appears once you tick anyone from the on-call pool: the flat amount each on-call cleaner earns. Your subcontractors keep their usual rate.
- **Positions needed** — how many people you need, from 1 to 50.
- **Expires in (minutes)** — 5 to 1440 (24 hours); 30 by default. After that, the link says the offer has expired.
- **Notes** — for the office only. Not included in the text.
- **Recipients** — tick people under **Your subcontractors** and **On-call pool** (each group has **Select all**). On-call cleaners who replied STOP aren't listed.

The page previews the exact text each group will get, then **Send to N recipients**. The texts go from your company's texting number (see [Texting](help:texting)). If nobody is on either list yet, the page sends you to the on-call pool to add someone first.

## What the recipient sees

The text names the service, day and time, length, pay (or "Paid at your usual rate"), and the area, with *First to claim gets it* — or *N spots available — claim yours* when you need more than one.

Their link opens a page with the same details and an **I can do this shift** button. Before claiming they see only the general area, not the street address or the client's details, since most people on the list won't get the shift. After claiming, the page says **You got it** and shows the full address, the client's phone and the client's standing notes, and they get a confirmation text with a link back to it.

If the spots are gone the page says *All positions have been filled. Sorry!*; it also says when the offer expired or *was cancelled by the company*, or when they've already claimed it.

One of your own subcontractors can only claim a shift they're free for: if they're already on another job at that time, the claim is refused with the clashing job named. A deactivated person's link no longer works.

Offered shifts aren't listed in the field app's **Shifts** page — that page only shows work already assigned to the cleaner. The text message link is how a shift is claimed.

## When someone claims

- Owners, admins and managers get a **Shift claimed** notification, linked to the booking.
- One of your subcontractors is put straight onto the job's crew (counted as accepted), so it appears in their field app with its checklist, and they clock in as usual.
- An on-call cleaner shows on the booking, the bookings list and the scheduler beside any crew, tagged *(subcontractor)*. Their flat pay is owed once the job completes; see [Contractor pay](help:contractor-pay).
- Google Calendars are brought up to date with who's on the job.

## Several spots

With **Positions needed** above 1, each claim fills one spot. The offer stays **Open** until every spot is taken, then becomes **Filled**, and anyone tapping their link after that is told it's full. Everyone who claimed shows on the booking. The same person can't claim twice.

## Following an offer

After sending you land on the offer's page: the shift, its status, **On-call pay**, **Positions**, **Expires**, **Filled**, your notes, **View booking**, and **Dispatches** — one row per person it went to, marked **Your subcontractor** where it applies, with whether the text went out, their claim link, and **Claimed** once they've taken it. **How claiming works** recaps the rules.

**Cancel offer** closes an open offer. No text goes out; anyone who opens their link afterwards sees that it was cancelled.

All offers are listed on [Job offers](/app/freelancers/offers) — from **On-call pool → Offers** — newest first: **Shift**, **When**, **Pay**, **Dispatches**, **Created** and **Status** (Open, Filled, Cancelled or Expired). Each booking's page also has a **Subcontractor offers** card listing that job's offers, with **New offer**.

## Unfilled-shift alerts

Once a day Sollos looks for pending or confirmed jobs starting within the next 24 hours that nobody is covering — no crew member and no claimed offer. Each one sends owners, admins and managers an **Unfilled shift in < 24h** notification (*… has no one assigned*), linked to the booking, at most once per job a day. It's controlled by **Unassigned booking alert** in [Settings → Automations](/app/settings/automations).

The same gaps show in other places as they happen: the **Starts soon · no one assigned** chip on the bookings list, and the **Needs coverage** panel on the scheduler.

## Common questions

**Who gets the shift if two people tap at once?** The first claim to land wins the spot; with several spots, claims fill them in order until none are left. Everyone after that sees that it's full.

**Do my regular employees get offers?** No. Only people set up as subcontractors under Employees, and the on-call pool.

**How much does an on-call cleaner get paid?** The **On-call pay** you set on the offer, per person, once the job completes. Your own subcontractors are paid their usual rate from their clocked hours instead.

**Can I take an offer back?** Yes — **Cancel offer** on the offer's page, while it's open. Nobody is texted; their links show it was cancelled. Someone who already claimed stays on the job until you change the crew.

**Why didn't anyone receive the text?** Check the **Dispatches** list on the offer's page — a failed text shows its error there. Texts need your company's texting set up.

**A cleaner is sick — how do I replace just her?** Open the job, **Offer shift**, and pick her under **Replacing**. The first person to claim takes her place at the same times, and she's told she doesn't need to go.

**Why didn't I get an unfilled-shift alert?** It runs once a day, only for jobs in the next 24 hours, only when **Unassigned booking alert** is on, and not for a job covered by a claimed offer.
`,
};
