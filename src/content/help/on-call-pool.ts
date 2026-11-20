import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "on-call-pool",
  title: "On-call pool",
  blurb: "Your list of outside cleaners to text when you need cover, and how it differs from subcontractors on your roster.",
  section: "Your team",
  paths: ["/app/freelancers", "/app/freelancers/new", "/app/freelancers/[id]/edit"],
  keywords: ["freelancer", "bench", "outsourcing", "outsource", "backup cleaner", "emergency coverage", "overflow", "temp", "casual", "sub list", "contact list"],
  body: `
The **On-call pool** is a contact list of outside cleaners you can text when you need cover: someone called in sick, a job came in that nobody's free for. People in the pool don't have a Sollos login and aren't on your roster. When you offer a shift, they get a text and claim it from a link.

It sits under **People** in the sidebar. Owners and admins can always open it; managers need the **On-call pool & subcontractor pay** area switched on in their access (see [Roles & permissions](help:roles-and-permissions)).

## On-call pool or subcontractor on your roster?

Both can be offered shifts, but they're different kinds of people:

- **Subcontractors on your roster** live under **Employees** with the engagement set to Subcontractor. They have a login, see their jobs in the field app, clock in and out, and are paid their usual hourly rate through Subcontractor pay. See [Employees & team members](help:employees).
- **On-call pool contacts** live here. They're just a name and a phone number: no login and no clocking in. When you offer them a shift you set a flat on-call amount for it.

Where you found someone changes nothing about how they're paid. Paying both kinds is covered in [Contractor pay](help:contractor-pay). If someone becomes a regular, invite them under Employees as a subcontractor so they get the field app.

## Adding someone to the pool

1. Go to **On-call pool** and click **New contact**.
2. Enter their **Full name** and **Phone** (both required), and optionally **Email** and **Notes**, such as "Prefers weekends, has own car".
3. Leave **Active** ticked to include them when you send out offers.
4. Click **Add to on-call pool**.

A ten-digit number like 780 271 1971 is read as a North American number. For other countries, type it with the country code, such as +44…. The phone has to be a full, textable number, because offers go out by text.

## The pool page

The list shows each contact's name, phone, email, whether they're **Active** or **Inactive**, and when they were last offered a shift and last accepted one. Click a row to edit them. The edit page also shows their recent offers and how each text went.

Above the list, an **Unassigned jobs** panel lists pending or confirmed jobs that nobody is covering yet. A job less than 24 hours away is tagged **Urgent**. Each has an **Offer shift** button. The **Offers** button at the top of the page lists the offers you've sent. How offers, claims and expiry work is in [Shift offers](help:shift-offers).

## Taking someone out of the pool

- **Untick Active** to stop including them in offers while keeping them on the list, say for someone away for the summer.
- **Remove from on-call pool**, at the bottom of their edit page, takes them off the list for good. Their past offers stay in the offer history.

## Common questions

**Do people in the on-call pool need to download the app?** No. They get a text with a link and claim the shift from it. They never sign in.

**Why isn't my own subcontractor in the on-call pool?** Subcontractors on your roster live under **Employees**, not here. When you offer a shift you can send it to your subcontractors, to the on-call pool, or both.

**Someone replied STOP to an offer text. What happens?** Sollos stops texting them offers, even if they're still marked Active. If they reply START to the same number later, offers resume.

**How much do on-call cleaners get paid?** You set a flat on-call amount each time you offer a shift. Subcontractors on your roster keep their usual hourly rate. See [Contractor pay](help:contractor-pay) for recording what you owe.

**Can I add someone without a phone number?** No. Offers go out by text, so a phone number is required.
`,
};
