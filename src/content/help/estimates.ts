import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "estimates",
  title: "Estimates",
  blurb: "Writing a quote, price ranges, sending it, the client approving or declining online, and turning it into a booking.",
  section: "Clients & sales",
  paths: ["/app/estimates", "/app/estimates/new", "/app/estimates/[id]/edit"],
  keywords: ["quote", "quotation", "proposal", "bid", "price range", "approve", "accept estimate", "decline", "expired estimate", "estimate pdf"],
  body: `
An estimate is a price you offer a client or lead before any work is booked. You write it in Sollos and send it by email. The client opens it on a page with your branding and taps **Approve estimate** or **Decline**, and you're told either way. An approved estimate becomes a booking with one click.

Estimates are under sidebar → **Operations** → **Estimates**. Owners, admins, and managers with **Invoices & estimates** access can use them. The **New estimate** button on the Estimates list only shows for owners and admins. Managers start one from a client's profile, or with **Quote** on a lead.

## Writing an estimate

Start from **Estimates → New estimate**, from **New estimate** on a client's profile, or from **Quote** on a lead. Starting from a lead picks them as the client, and their "What do they want?" note becomes the summary. The person doesn't have to be in Sollos already (see step 1).

1. Choose who it's for. **Someone on your books** lets you pick a client or lead under **Client or lead**. **Someone new** is for a person who isn't in Sollos yet: type **Their name**, plus an **Email** (needed to send the estimate) and a **Phone** if you have them. Saving adds them as a lead, not a client; they become a client when they're booked. If the email matches someone already on your books, the estimate goes on that person's record instead, so nobody is entered twice.
2. Optionally write a **Summary**: a sentence or two shown above the line items.
3. Add **Line items**: a **Description**, **Qty**, and **Price each** for each thing you're quoting. **Add line item** adds another row. The total is the sum of the lines.
4. Not listing lines? Leave the rows empty and type the total in the box beside **Add line item** instead.
5. Optionally add **Notes** and attach your own **PDF** (up to 10 MB) with **Upload PDF**.
6. Press **Create estimate**.

> The client sees the summary, the line items, the total, and the **Notes**. Don't put anything in Notes you wouldn't want them to read.

## Giving a price range

For a quote like "between $300 and $400", tick **Give a price range**. Each line then gets a **Price from** and a **Price to**, and the total shows as a range. Leave a line's **Price to** empty if that line is a fixed price. If you aren't using line items, type the low total and the high total in the box beside **Add line item**. The high end can't be lower than the low end.

The client sees the range on their estimate, in the email, and on the PDF, labelled **Estimated total**. A booking holds one price, so when a ranged estimate becomes a booking, the booking starts at the low end. Set the final price on the booking.

## Sending it

On the estimate's page, press **Send to client** (it reads **Resend to client** after the first send). The client needs an email address on file. Sollos emails them a link to the estimate with a PDF copy attached. After sending:

- The status changes from **Draft** to **Sent**.
- The client's link is valid for 30 days from the send. Resending gives it another 30 days.
- A lead on **New** or **Contacted** moves to **Quoted**.

To share the estimate yourself instead, for example by text, use the **Share & PDF** section:

- **Download PDF**: opens a PDF copy with your branding in a new tab, for your records or to send yourself.
- **Create client link**: makes the client's link without emailing it. It's valid for 30 days. Once there's a link, **View client page** opens it and **Copy link** copies it.

## What the client sees

The link opens **Your estimate**, from your company, with your logo. It shows the summary, the line items, the total (or range), the notes, the date it's **Valid until**, and a **Download PDF** button. If you attached your own PDF, there's a link to that too.

While the estimate is **Draft** or **Sent** and hasn't expired, the client sees **Approve estimate** and **Decline**. Decline asks them to confirm first. They can answer only once. To change an answer afterwards, they have to contact you, and you change the status yourself.

## When the client answers

- **Approved**: the estimate is marked **Approved**, and owners, admins, and managers get an "Estimate approved" notification.
- **Declined**: it's marked **Declined**, with a matching notification.
- **Expired**: after the link expires, the page tells the client to contact you for a new quote, and the buttons are gone.

If you've turned on **Draft a booking when an estimate is approved** in **Settings → Client messages**, an approval (by the client, or by you setting the status) also creates a placeholder booking. It's **Pending**, set for tomorrow at 9 AM, unassigned, and linked to the estimate. You pick the real date, time, and cleaner. The client isn't told about the placeholder, and owners and admins get a notification to schedule it. If the client was a lead, the booking makes them a client.

## Turning it into a booking

On the estimate's page, press **Book this job**. A new booking opens with the client, the price, and the summary (as booking notes) already filled in. Once you save it, the estimate page says **This estimate was converted to a … booking** with a link to it. The estimate's own status doesn't change.

## Statuses

**Draft**, **Sent**, **Approved**, **Declined**, and **Expired**. Sollos sets most of them for you (sent when emailed, approved or declined when the client answers). You can also set any status yourself from the **Status** field on the estimate and save.

## Follow-ups and expiry

Under **Winning the work** in **Settings → Client messages**, you can turn on:

- **Estimate follow-up**: 7 days after sending, if there's no answer, the client gets a "still interested?" email. A second "last chance" email goes out at 14 days.
- **Stale-estimate alert to you**: owners and admins are told when an estimate has been **Sent** for 7 days or more with no answer.
- **Auto-expire stale estimates**: estimates still **Sent** after 30 days with no activity change to **Expired**.

Like every automation, these are off until you turn them on.

## Estimates from your website

Your website's estimate calculator creates a draft estimate for each request, with the person as a lead. The total is set to the top of the first-clean price they were shown, and the calculator's details (rooms, add-ons, schedule, where they heard about you) are written into **Notes**. Read and tidy those notes before you send it, because the client sees them. See [Website forms](help:website-forms).

## The Estimates list

The list shows each estimate's client (with their email and phone), summary, created and sent dates, status, and total. A red file icon means a PDF is attached. Search by client or summary. Click an estimate to open it.

If **Auto-archive old records** is on in [Settings → Team alerts & housekeeping](/app/settings/team-alerts), estimates that were approved, declined, or expired longer ago than that move out of the list. **Show archived** shows them.

## Common questions

**Why can't I press Send to client?** The client has no email address. Add one on their client record, or use **Create client link** and send the link yourself.

**The client says the link says expired.** The link is valid for 30 days from the last send. Press **Resend to client** to email a fresh link. If the status is already **Expired**, set it back to **Sent** first, because an expired estimate can't be approved.

**Can a client change their answer?** Not from the link. They answer once. You can change the status on the estimate yourself.

**I approved an estimate but no booking appeared.** The placeholder booking only appears if **Draft a booking when an estimate is approved** is on. Otherwise press **Book this job** on the estimate.

**What price does the booking get from a range?** The low end. Change it on the booking once you know the final price.

**Do clients see my estimate notes?** Yes. Notes show on the client's estimate page and the PDF.

**Can I delete an estimate?** Yes: **Delete estimate** under **Danger zone** on the estimate's page. Its line items go with it, and it can't be undone.
`,
};
