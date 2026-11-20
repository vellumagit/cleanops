import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "website-forms",
  title: "Website forms",
  blurb: "Connecting your website's estimate calculator and contact form to Sollos, and where each submission lands.",
  section: "Website & portal",
  paths: [],
  keywords: ["embed", "quote form", "contact form", "website", "intake", "web form", "lead form", "calculator"],
  body: `
Your website's estimate calculator and contact form can send submissions straight to Sollos, with no other service in between. Each submission becomes a lead you can work, a request in your inbox, and an alert to you.

## Connecting a form

You keep the form on your own website. Sollos gives you an address to send the form's submissions to.

1. Go to [Settings → Intake forms](/app/settings/intake-forms). Owners and admins only.
2. Under **New intake form**, give it a **Name**, pick the **Type** (**Estimate calculator** or **Contact form**), and press **Create**.
3. Copy the **Webhook URL (POST here)** it shows.
4. Set your website form to send its submissions to that address. Whoever built your site can do this: the form's action, or its submit code, posts to the URL.
5. Name your form's fields to match the ones Sollos recognizes (below).

The same page offers a **Job application** type, which sends applicants to the Applicants page (see [Hiring](help:hiring)). The technical details of the intake address (accepted formats, responses) are in [API and webhooks](help:api-and-webhooks).

**The address is the key.** Anyone who has it can send you submissions, so treat it like a password. On the Intake forms page, each form has:

- **Regenerate URL**: makes a new address and switches the old one off. Update your website afterwards.
- **Disable** (and **Enable**): stops the address accepting submissions until you turn it back on.
- **Delete**: removes the form.

## Fields Sollos recognizes

Settings → Intake forms lists the field names for each type. Name your website's inputs the same way and everything lands in the right place.

- **Estimate calculator**: fullName or name; email, phone; address, city; bedrooms, bathrooms, kitchens; pets, oven, fridge, windows, blinds, carpets; schedule, cleaningDate; the calculator's prices (priceInitialHigh, priceRecurringHigh, travelFee); hearAboutUs, notes. Only a name is required.
- **Contact form**: name or fullName; email, phone; city; urgency; notes or message; page_url, referrer; and website (the spam trap, see below).

Plain HTML forms can send the visitor to your own thank-you page: add ?redirect= followed by your page's https address to the end of the Webhook URL.

## What one submission does

**From the estimate calculator:**

- Creates a **lead**, or updates the existing one if the email matches (see below). The lead's source is **Website form**, or **Referral** if they said they heard about you through a referral.
- Adds the request details to the lead's **What do they want?** note.
- Drafts an **estimate** for them. The total is the top of the first-clean price range your calculator showed, and the calculator's details go into the estimate's **Notes**.
- Puts an open inquiry on the [Requests](/app/bookings/requests) page.
- Emails the visitor a confirmation from your company.
- Notifies owners and admins in the app ("New estimate request").
- Sends the lead alert email and, if you've turned it on, the lead alert text (see [Lead alerts](help:website-forms#lead-alerts-email-and-text)).

**From the contact form:** all of the above except the estimate. The in-app notification reads "New website inquiry".

The lead, the inquiry, and the estimate show the person's **email, phone, and address**: on the inquiry card, under their name on the Estimates list, and at the top of the estimate. You don't have to go back to Leads to find out how to reach them.

> Review an auto-drafted estimate before you send it. The client sees its **Notes**, which hold the calculator's raw details, including a line saying the total was set to the top of the range. Adjust the price and tidy the notes first. See [Estimates](help:estimates#estimates-from-your-website).

## Same email, one person

When a submission comes in, Sollos looks for someone you already have with the same email (capital letters don't matter). If there's no email match, it looks for someone with the same name and no email on file, and fills in the email and phone they just gave.

- A match that's **already a client** stays a client. Asking for a quote never turns them back into a lead.
- A match you'd marked **lost** comes back as an open lead in the **Contacted** stage.
- Different email addresses create separate leads. If you spot the same person twice, tidy it up by hand.

## Lead alerts: email and text

Both alerts have a switch at the top of **Settings → Intake forms**.

- **Email me when a lead comes in** is on by default. It keeps working even when your automations master switch is off, because a missed lead costs more than a stray email. It goes to every owner and admin, plus your company contact email from [Settings → Email & contact info](/app/settings/email). Turn it off there if you'd rather rely on the in-app notification.
- **Text me when a lead comes in** is off until you turn it on, like every other text. It needs texting turned on (see [Texting](help:texting)). It goes to each owner's and admin's profile phone plus your company contact phone, and counts against your included texts. The text carries the person's name, phone or email, where they are, and the start of what they asked.

## Spam and limits

The contact form and the estimate calculator both have a spam trap: a hidden field named "website" that people never see. Bots fill it in, and those submissions are quietly thrown away. Keep that field hidden and empty on your form.

To stop a form flooding you:

- Each form accepts up to 60 submissions an hour.
- One visitor's address gets at most three confirmation emails an hour. The lead is still recorded either way.

## The inquiry closes itself

An inquiry stays open on Requests until the person stops being a question mark. When you convert their lead, mark it lost, or book them, their open inquiries close automatically.

## Common questions

**Do I get a form to embed on my site?** No. Sollos doesn't host the form. Your website keeps its own form and sends submissions to your intake address.

**Submissions stopped arriving.** Check the form shows **Active** on Settings → Intake forms. If someone pressed **Regenerate URL**, your website still has the old address. Copy the new one into your form.

**Why didn't I get the lead email?** Check **Email me when a lead comes in** is on, and that your company contact email in Settings → Email & contact info is the inbox you watch. The lead is in Sollos either way: look on Leads or Requests.

**A website lead was already my client. Did Sollos make a duplicate?** Not if they used the email you have on file. The submission attaches to their existing client record and doesn't turn them into a lead.

**Where does the estimate calculator's price go?** Into the draft estimate's total (the top of the first-clean range), with the full breakdown in the estimate's Notes. Adjust it before sending.

**Can job applications come from my website too?** Yes. Create an intake form with the type **Job application**. Applicants land on the Applicants page.
`,
};
