import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "company-settings",
  title: "Company settings",
  blurb: "Services and prices, logo and colour, the email clients see, currency and tax, holidays, and your time zone.",
  section: "Settings & connections",
  paths: ["/app/settings", "/app/settings/services", "/app/settings/branding", "/app/settings/email", "/app/settings/currency", "/app/settings/timezone"],
  keywords: ["settings", "service list", "price list", "logo", "brand colour", "color", "sender", "from address", "reply-to", "gst", "hst", "vat", "sales tax", "time zone", "stat holiday"],
  body: `
**Settings** (bottom of the sidebar) is where you set up the business itself: what you sell, how you look, how email reaches clients, money formats, and the clock everything runs on. Settings is for **owners and admins only** — managers and employees don't see it.

The page groups everything into sections — **Learn**, **Business**, **Team**, **Automations**, **Integrations**, **Account** — ordered so the things clients see and the things that touch money sit near the top. This guide covers the business basics. The rest have their own guides: [Texting (SMS)](help:texting), [Automations](help:automations), [Integrations](help:integrations), [API keys, webhooks & intake forms](help:api-and-webhooks), and [Account & security](help:account-and-security). Payment instructions are in [Getting paid](help:getting-paid), team members in [Employees](help:employees), bonus rules in [Bonuses](help:bonuses).

On a phone, the top of Settings also has the card that installs Sollos on your home screen.

## Services

[Settings → Services](/app/settings/services) is the list of services that appear in the **Service** dropdown when you create a booking or a contract. Every company starts with a set of baseline services; rename them, change their defaults, archive the ones you don't offer, and add your own (window cleaning, office turnover, anything).

Click **Add service**, or **Edit** on an existing one. Each service has:

- **Name** — shown in the booking form and on bookings. Two services can't share a name.
- **Category** — the closest match from a fixed list (Standard clean, Deep clean, Move-out clean, Recurring clean, Meeting, Consultation, Walkthrough, Other). Reports group work by it.
- **Description** — optional; shown as a hint under the name.
- **Default duration (min)** and **Default price** — these pre-fill the booking form when you pick the service. The price only fills **Total** if it's still empty, and the length only fills if you haven't set one, so choosing a service never overwrites a number you typed. Leave the price blank if you quote every job.
- **Sort order** — lower numbers show first in the dropdown.
- **Calendar color** — a hex code such as #00aaff, shown as the dot beside the service in this list.
- **Active (shown in the booking form)** — untick to hide it without archiving.

The archive button (the box icon) asks first, then removes the service from the booking form. **Archiving never breaks history**: bookings that used it keep their label. Archived services sit in a collapsed list at the bottom with a **Restore** button.

**Linking a checklist to a service** happens on the checklist, not here: open the checklist in **Checklists** and set **Auto-add to a service**. From then on that checklist lands on every new booking of that service, recurring visits and already-scheduled ones included. See [Checklists](help:checklists).

## Branding

**Settings → Branding** holds your logo, your brand colour, and your Google review link. Press **Save branding** when you're done.

- **Company logo** — PNG, JPEG, WebP or SVG, up to 2 MB. It appears on invoices, public links, and the field app. **Upload** (or **Replace**) picks a file; **Remove** takes it off.
- **Brand colour** — pick one of the eight presets or type a 6-digit hex value. It's the accent on invoices and public pages, and the highlight on the active link in your sidebar. The **Preview** box shows a mock invoice header with a **Pay now** button in your colour as you choose.
- **Google Review link** — paste your Google Business Profile review link (it must start with https://). Find it in Google Business Profile under *Ask for reviews → Share review link*. A client who leaves a 4- or 5-star review in Sollos then sees a **Share on Google** button that opens it, and the Google review request automation needs it to send anything (see [Automations](help:automations)).

## Email & contact info

**Settings → Email & contact info** has two separate forms, because "who the email is from" and "how a client reaches you" are different questions.

### Sender email

The From address on invoices, booking confirmations and review requests. It has to be on your business's own domain — Gmail, Yahoo, Outlook, Hotmail, iCloud and similar are refused, because mail claiming to come from them gets filtered as spam.

1. Type the address and press **Save & verify** (or **Update & re-verify** if one is already set).
2. Sollos emails a verification link to that address. Click it within 24 hours.
3. The page shows **Verified** once you have.

You can send five verification emails a day. Leave the field blank and save to go back to the default.

> Verifying proves you own the inbox, but Sollos only sends *from* your address once your domain is also set up for sending on Sollos's side. Until then, mail still goes out from noreply@sollos3.com — with **your business name** as the sender name, so clients see your name in their inbox, not "Sollos".

Either way, the sender name on every client email is your business name.

### Contact info on invoices

- **Contact email** — shown on invoices and the public invoice page so clients know where to send questions. Any address works here, Gmail included. It is also where client replies go: when it's a business-domain address, hitting **Reply** on a Sollos email reaches it directly. When it's a Gmail-style address, Sollos prints it in the body of the email instead of the reply header, because a business sender with a free-mail reply address is a classic spam pattern that hurts delivery.
- **Contact phone** — shown on invoices alongside the email, formatted however you like. Texting uses it too: a client who texts HELP gets this number, and when Sollos buys you a texting number it looks for one in this phone's area code.

Press **Save contact info**.

## Currency, tax & holidays

**Settings → Currency, tax & holidays** has three small forms, each with its own save button.

- **Currency** — Canadian dollars (CA$125.00) or US dollars (US$125.00). This is how invoices, estimates and dashboard amounts display. Card payouts settle in the currency of the Stripe account you connect, not this setting.
- **Default tax** — a **Tax label** (GST, HST, VAT — whatever clients should see) and a **Rate (%)** from 0 to 99.99. Every new invoice starts with it, and each invoice can still change or drop it. Each invoice keeps the rate it was created with, so changing the default never edits an old invoice. Leave the rate blank for no default tax.
- **Holidays** — pick a **Country**, and a **Province / state** where holidays vary by region (Alberta's Family Day is why that box exists). That region's statutory holidays then show as a label on the day in the scheduler — nothing is blocked, you can still book. It's worked out locally; no calendar account is needed. Choose **Off — no holidays shown** to turn it off.

> The holiday country does one more job: it is how Sollos tells a US business from a Canadian one for texting, which decides whether you need to register with the US carriers first. See [Texting (SMS)](help:texting).

## Timezone

**Settings → Timezone** sets your company's time zone. The page shows the current time in that zone so you can check it at a glance. Pick from the list and press **Save timezone**.

Times your team types in — a booking's start time, a recurring schedule — are read in this zone, and booking times across the office are shown in it. Scheduled emails such as a cleaner's morning schedule work out "today" from it too.

**What happens to bookings you already have.** Each visit remembers the exact moment it was booked for and the zone it was booked in, so changing this setting **doesn't move any existing visit**. They will, however, now *display* in the new zone: a 9:00 AM visit booked in Edmonton shows as 8:00 AM once you switch to Vancouver, because that's the same moment. New bookings use the new zone. So set this once when you start, and only change it if the business really moved.

The list includes zones without daylight saving — **Central — no DST (Regina)** and **US Mountain — no DST (Phoenix)**. Alberta stays on one time year-round from November 2026; Sollos keeps existing visits at the clock time they were booked for when rules like that change. See [Bookings](help:bookings#recurring).

## Common questions

**I archived a service by mistake. Can I get it back?** Yes. Open the archived list at the bottom of **Settings → Services** and press **Restore**. Nothing about past bookings changed while it was archived.

**I changed a service's price. Do existing bookings change?** No. The default price only pre-fills the **Total** on a new booking when you pick the service. Bookings already made keep their own price.

**Why do my emails still come from noreply@sollos3.com after I verified my address?** Verifying proves the inbox is yours; sending from it also needs your domain set up for sending on Sollos's side. Until then emails come from noreply@sollos3.com with your business name as the sender, and replies still reach your contact email.

**Why won't it accept my Gmail as the sender email?** Sending as a free-mail address from another service gets filtered as spam, so the sender email must be on your own domain. Put the Gmail address in **Contact email** instead — that's where client replies and questions go.

**I changed my tax rate. Why does an old invoice still show the old rate?** Each invoice saves its own rate when it's created. The default only applies to invoices made after you change it; edit an individual invoice to change its tax.

**Will changing the time zone move my bookings?** No. Every booking stays at the same moment. They'll display in the new zone, so the clock time you see may shift by the difference between the two zones.

**Can I block bookings on statutory holidays?** No. Holidays are a label on the scheduler so you book knowingly; they never stop a booking.

**Who can change these settings?** Owners and admins. Settings doesn't appear for managers or employees.
`,
};
