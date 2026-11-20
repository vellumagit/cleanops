import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "network",
  title: "Network",
  blurb: "Your contact list for realtors, property managers, suppliers, and referral partners: people who matter but aren't clients.",
  section: "Clients & sales",
  paths: ["/app/network", "/app/network/new", "/app/network/[id]/edit"],
  keywords: ["rolodex", "contacts", "realtor", "property manager", "supplier", "vendor", "referral partner", "partners"],
  body: `
**Network** (sidebar → **People** → **Network**) is your list of people who matter to the business but aren't clients: the realtor who sends you move-out cleans, property managers, suppliers, referral partners. It's built for a phone: find the person and tap to call or email.

Owners, admins, and managers can use it.

## Adding a contact

1. On [Network](/app/network), press **Add contact**.
2. Fill in **Name**, and pick a **Category**: **Realtor**, **Property manager**, **Supplier**, **Referral partner**, or **Other**.
3. Optionally add a **Company**, **Phone**, **Email**, and **Notes**, for example how you know them, what they refer, or their referral terms.
4. Press **Add contact**.

## Finding someone

Search by name, company, email, phone, or anything in the notes. The category chips above the list (**All**, then each category you've used) narrow it to one kind of contact. Each card shows the name, category, and company. Tap the phone number to call or the email to write. Notes show under the details.

## Editing and deleting

Press the pencil on a card to edit the contact, then **Save changes**. **Delete contact** is at the bottom of that page. It deletes immediately, without asking you to confirm.

## How Network is different from clients and the on-call pool

- **Not clients.** Network contacts have no bookings, invoices, or portal. If a network contact books a cleaning for themselves, add them as a client like anyone else (see [Clients](help:clients)).
- **Not the on-call pool.** Nobody in Network is offered shifts. The on-call pool is for cleaners you text shifts to (see [On-call pool](help:on-call-pool)).
- **Nothing is sent automatically.** Sollos never texts or emails network contacts. The phone and email are there for you to tap.

## Common questions

**Can I book a job for a network contact?** Not from Network. Add them as a client, then book them.

**Will Sollos text my network contacts?** No. Nothing is sent to them automatically.

**Can I add my own categories?** No. The categories are fixed. Use **Other** and the notes for anything that doesn't fit.

**I deleted a contact by mistake.** Deleting can't be undone from the app. Add the contact again.
`,
};
