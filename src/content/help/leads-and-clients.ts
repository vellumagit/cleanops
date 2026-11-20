import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "leads-and-clients",
  title: "Leads",
  blurb: "People who've asked but haven't booked: adding them, the New, Contacted and Quoted stages, and how they become clients.",
  section: "Clients & sales",
  paths: ["/app/leads"],
  keywords: ["prospect", "inquiry", "pipeline", "lost lead", "follow up", "make client", "convert", "potential customer"],
  body: `
A lead is someone who has asked about your service but hasn't booked yet. The **Leads** page (sidebar → **People** → **Leads**) is the list of people waiting to hear back from you, grouped by how far along they are. Once someone books, they move to **Clients** on their own (see [Clients](help:clients)).

Owners, admins, and managers with **Client records** access can use the Leads page. Leads are client records that haven't booked yet, so the same access setting covers both.

## How leads arrive

- **You add them.** The quick-add form at the top of the page. Only **Name** is required, so you can add someone mid-call.
- **Your website sends them.** Your estimate calculator and contact form create leads automatically (see [Website forms](help:website-forms)).
- **Your chat tool sends them.** ManyChat, GoHighLevel and similar tools can pass on leads from Instagram, Facebook, TikTok or WhatsApp, filed under that network (see [Website forms](help:website-forms#leads-from-instagram-facebook-and-chat-tools)).
- **They come back.** If someone you marked lost fills in your website form again, they come back as a lead in the **Contacted** stage.

## Adding a lead by hand

1. Go to [Leads](/app/leads).
2. Type their **Name**. **Phone** is optional.
3. Pick where they **Came from**: Phone (the default), Email, Website form, Referral, Instagram, Facebook, TikTok, WhatsApp, Social / chat, or Other.
4. Optionally add their **Email** and **What do they want?** (for example "3 bed, biweekly, asked about Thursdays").
5. Press **Add**. The form clears so you can add the next person.

Phone numbers are saved in the same format as client numbers, so texting works for them after they become a client.

## The stages

Open leads are grouped by stage:

- **New**: they asked and nobody has replied yet.
- **Contacted**: you've spoken to them but haven't given a price.
- **Quoted**: they have a price and you're waiting on them.

Each lead row has stage buttons. Tap one to move the lead there. Stages can go backwards too, so if you quoted the wrong thing you can put a lead back on **Contacted**.

One stage changes on its own: when you send a lead an estimate by email, a lead on **New** or **Contacted** moves to **Quoted**.

## Working a lead

Every lead row has:

- **Edit**: opens a small window where you change their name, phone, email, address, and **What do they want?**. You edit leads on this page, not on a client profile, because they aren't clients yet.
- **Quote**: opens a new estimate with the lead already picked. Whatever is in their **What do they want?** note becomes the estimate's summary. See [Estimates](help:estimates).
- **Book**: opens a new booking with the lead already picked. Saving the booking makes them a client.
- **Make client**: they said yes.
- **Lost**: they went somewhere else.

## How a lead becomes a client

A lead becomes a client in any of these ways:

1. You press **Make client**.
2. You create a booking for them, one-off or recurring. In a cleaning business, booking someone is the yes, so you don't have to remember the button.
3. An estimate is approved and your **Draft a booking when an estimate is approved** automation creates a booking for it (see [Estimates](help:estimates#when-the-client-answers)).

Nothing is copied or lost when they convert. Their estimates, notes, and properties come with them, because a lead and a client are the same record. Their stage is cleared and they move from Leads to the Clients page.

> When a lead becomes a client or is marked lost, any open website inquiries from them on the [Requests](/app/bookings/requests) page are closed automatically. Their question has been answered either way.

## Lost leads

**Lost** keeps the person but takes them off your working list. To see them, use the **Lost leads** link at the top of the page. Each lost lead has a **Reopen** button, which puts them back on the list in the **Contacted** stage. Use it when they call again.

## Common questions

**I booked a lead. Where did they go?** They're a client now. Creating any booking for a lead converts them, so look for them on the Clients page.

**Why is a lead showing as Quoted when I never moved them?** Sending them an estimate by email moves a lead on New or Contacted to Quoted automatically.

**Someone filled in my website form twice. Do I have two leads?** Not if they used the same email address. The second submission updates the same lead and adds to their **What do they want?** note. If they used a different email, you'll have two separate records.

**An existing client asked for a quote on my website. Are they a lead now?** No. A form submission from someone already on your books stays with their client record and never turns them back into a lead.

**Can I delete a lead?** Not from the Leads page. Mark them **Lost** instead: they leave your working list and you keep the history in case they come back.

**Why can't my manager see Leads?** Leads need the **Client records** access setting. If a manager has that switched off, they can't open Leads or Clients. See [Roles and permissions](help:roles-and-permissions).
`,
};
