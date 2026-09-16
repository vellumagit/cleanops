export const body = `
Your website's estimate calculator and contact form post straight into Sollos — no middleman service. One submission does all of this at once:

- Creates (or updates) a **lead** with everything they typed.
- Files an open **inquiry** on the Requests page, counted in its badge.
- For estimate requests, drafts an **estimate** with their numbers attached.
- Emails the visitor a branded confirmation from your org's sender.
- Emails every owner and admin **and** your organization's contact email (Settings → Organization), and notifies every admin in-app.
- Optionally texts the same people from your own number.

## Lead alerts: email and text

Both alerts have a switch at the top of **Settings → Intake forms**.

- **Email me when a lead comes in** is on by default and keeps working even when the automations master switch is off — a missed lead costs more than a stray email. Turn it off there if you'd rather rely on the in-app notification.
- **Text me when a lead comes in** is off until you turn it on, like every other text. It needs SMS enabled (Settings → SMS), goes to each owner's and admin's profile phone plus your organization's contact phone, and counts against your included texts. The text carries the person's name, phone or email, where they are, and a snippet of what they asked.

The lead, the inquiry and the estimate are the same submission seen from three places, and each shows the person's **email, phone and address** right there — on the inquiry card, under the client's name in the Estimates list, and at the top of the estimate — so you never have to go back to Leads to find out how to reach them.

## How the connection works

Each form on your site posts to a Sollos **intake URL** — created under **Settings → Intake forms**, one per form type (estimate request, contact, job application). The URL's token is the key; treat it like one. Deactivating the form kills the URL instantly.

Each intake form's page lists the **fields we recognize** — name your website form's inputs to match and everything lands labeled; unrecognized extras still arrive in the notes rather than being lost.

## Spam

The contact endpoint has a honeypot: a hidden field named \`website\` that humans never see. Bots fill it; those submissions are accepted-and-discarded silently, so the bot learns nothing and your Requests stay clean.

## The loop closes itself

An inquiry stays open on Requests until the person stops being a question mark: convert their lead, mark it lost, or book them, and their open inquiries resolve automatically.

> Same email, one lead. Repeat submissions from one address update the existing lead and add to its trail instead of stacking duplicates.
`;
