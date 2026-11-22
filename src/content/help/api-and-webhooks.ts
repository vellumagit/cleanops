import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "api-and-webhooks",
  title: "API keys, webhooks & intake forms",
  blurb: "Connecting Zapier, Make.com, n8n or your own website: API keys, outbound webhooks, and inbound form URLs — written to hand to your web person.",
  section: "Settings & connections",
  paths: ["/app/settings/api-keys", "/app/settings/webhooks", "/app/settings/intake-forms"],
  keywords: ["api", "api key", "token", "zapier", "make.com", "integromat", "n8n", "webhook", "developer", "rest", "json", "typeform", "jotform", "form url", "intake url", "endpoint", "manychat", "gohighlevel", "ghl"],
  body: `
Three settings pages let other software talk to Sollos. You don't need to be technical to set them up — create the key or URL here, then hand it (and this page) to whoever looks after your website or automations.

- **API keys** — let a tool like Zapier, Make.com or n8n *read and change* your clients, bookings, estimates and invoices.
- **Webhooks** — Sollos *tells* another system when certain things happen.
- **Website & lead forms** (intake forms) — a URL your website's forms (or Typeform, Jotform, Zapier) send submissions to, so they land in Sollos as leads, requests or job applicants.

API Keys and Webhooks are in the **Connections** group on the Settings page; Website & lead forms is in the **Clients** group, beside the alerts for new leads. All three are for **owners and admins only**. For ready-made connections (Stripe, QuickBooks, Google Calendar) see [Integrations](help:integrations).

## API keys

**Settings → API Keys.**

1. Press **Create API key**.
2. Give it a **Label** you'll recognise later ("Zapier", "Make.com production") and press **Generate key**.
3. The key appears once, starting with \`sk_live_\`. Copy it now and store it somewhere safe — **you won't be able to see it again**. Press **I've saved it — dismiss**.

The list shows each key's label, its first few characters, when it was created, and when it was last used. The bin icon **revokes** a key after you confirm: anything using it stops working immediately. Revoked keys stay listed, crossed out, for the record. Lost a key? Revoke it and create a new one.

> A key is the keys to the shop: it can read, create, change and delete records for your whole company, with no screen and nobody watching. Give each tool its own key so you can revoke one without breaking the others, and never paste a key into a public web page.

### For your developer

Send the key in the \`Authorization\` header of every request: \`Authorization: Bearer sk_live_…\`. Requests go to your Sollos address, \`https://sollos3.com\`.

- \`/api/v1/clients\` — list (GET) or create (POST); \`/api/v1/clients/:id\` — read, update (PATCH) or delete (DELETE).
- \`/api/v1/bookings\` — list or create; \`/api/v1/bookings/:id\` — read, update or delete.
- \`/api/v1/estimates\` — list or create; \`/api/v1/estimates/:id\` — read or update.
- \`/api/v1/invoices\` — list or create; \`/api/v1/invoices/:id\` — read or update.

Lists return \`data\` plus \`pagination\` (\`total\`, \`limit\`, \`offset\`): \`limit\` defaults to 25 and tops out at 100. Clients take \`search\` (name or email) and \`since\` (changed since a date); bookings take \`status\`, \`client_id\`, \`since\`, \`scheduled_after\` and \`scheduled_before\`. Creating a booking, estimate or invoice accepts either a \`client_id\` or a \`client_name\` (with optional email, phone and address) — a client is matched or created for you.

Each company can make **120 requests a minute**; beyond that the API answers 429 and says when to retry. A revoked or wrong key gets 401. Deletes through the API are permanent.

## Webhooks (outbound)

**Settings → Webhooks** sends a message to another system the moment something happens, so a Zapier or Make.com scenario can react — add a row to a spreadsheet, post in Slack, whatever you build.

> **Important:** webhooks currently fire for changes made **through the API or a website form** only. Changes you make inside the Sollos app — booking a job, completing it, recording a payment — don't send webhooks yet. The page says this at the top.

To set one up, open **+ Create webhook**:

1. **Name** — for your own reference ("Make.com booking trigger").
2. **URL** — where to send it, from your automation tool. It must start with https://; addresses on private or local networks are refused.
3. **Events** — tick at least one (the list is below).
4. Press **Create webhook**.

The events you can choose:

- \`booking.created\` — **New booking scheduled**
- \`booking.completed\` — **Booking marked complete**
- \`booking.cancelled\` — **Booking cancelled**
- \`invoice.created\` — **Invoice drafted**
- \`invoice.paid\` — **Invoice paid**
- \`client.created\` — **New client added** (also fires when a website contact or estimate form creates a new client)

If the URL isn't accepted (not https, or a private address) or no event is ticked, nothing is created — check the list after saving.

Each webhook in the list shows **Active** or **Paused**, its URL, how many events it listens for, and — once it has fired — **Last triggered** with the response code (green for success, red for a failure). **Pause** / **Resume** stop and restart it; the bin icon deletes it straight away, without asking.

### What gets sent

Each event is a POST with a JSON body in plain terms: an \`id\` for the event, the \`event\` name (such as \`booking.created\`), a \`timestamp\`, and \`data\` — the record that changed (the booking, invoice or client).

Every message carries an \`X-Sollos-Signature\` header: \`sha256=\` followed by an HMAC-SHA256 of the raw body, made with the webhook's secret, so the receiver can check it really came from Sollos. The page shows only the first eight characters of the secret; if your developer needs the whole secret to check signatures, use **Reach out** at the bottom of **Settings → Integrations**.

**Retries.** The receiving system has 10 seconds to answer with a 2xx code. If it doesn't — a timeout, a 5xx error, a network failure — Sollos tries again after about 2 seconds and again after about 10, three attempts in all. A 4xx answer (bad URL, wrong permissions) isn't retried, and a redirect counts as a failure, because redirects aren't followed.

## Intake forms (Website & lead forms)

**Settings → Website & lead forms** gives each of your outside forms a private URL. Point the form at it and every submission lands in Sollos automatically. For how this fits with your website, see [Website forms](help:website-forms).

### Creating one

Under **New intake form**, give it a **Name**, choose a **Type**, and press **Create**:

- **Job application** — submissions become applicants under **Applicants**.
- **Estimate calculator** — one submission creates a lead, a draft estimate and a request, emails the person a confirmation, and notifies you.
- **Contact form** — one submission creates a lead and a request, confirms to the sender, and notifies you.
- **Social & chat (ManyChat, GoHighLevel)** — one submission creates a lead with its network as the source and a request, and notifies you. The person is not emailed. See [Website forms](help:website-forms#leads-from-instagram-facebook-and-chat-tools).

Each form then shows its **Webhook URL (POST here)** with a copy button, plus:

- **Regenerate URL** — makes a new URL; the old one stops working at once. Use it if the URL leaked.
- **Disable** / **Enable** — a disabled form refuses submissions until you enable it.
- **Delete** — removes the form and its URL.

> The URL itself is the password: anyone who has it can submit. Treat it like a key.

### For your web person

Send a POST to the URL — JSON or form-encoded (multipart works for the estimate calculator). The page lists the field names each type recognises; name your form's inputs to match and everything lands labelled. Anything extra is still saved.

- **Job application** — \`name\` or \`full_name\`, \`email\`, \`phone\`, \`position\` or \`role\`, \`experience\`, \`availability\`, \`message\` or \`cover_letter\`, \`resume_url\` or \`resume\`. Nothing is required, but send at least a name or email.
- **Estimate calculator** — \`fullName\` or \`name\` (the only required field), \`email\`, \`phone\`, \`address\`, \`city\`, \`bedrooms\`, \`bathrooms\`, \`kitchens\`, \`pets\`, \`oven\`, \`fridge\`, \`windows\`, \`blinds\`, \`carpets\`, \`schedule\`, \`cleaningDate\`, \`priceInitialHigh\`, \`priceRecurringHigh\`, \`travelFee\`, \`hearAboutUs\`, \`notes\`.
- **Contact form** — \`name\` or \`fullName\`, \`email\`, \`phone\`, \`city\`, \`urgency\`, \`notes\` or \`message\`, \`page_url\`, \`referrer\`. Include a hidden, empty \`website\` field: bots that fill it in are silently dropped. Add \`?redirect=https://…\` to the URL to send a plain HTML form to your thank-you page afterwards.
- **Social & chat** — \`name\`, \`full_name\` or \`first_name\` + \`last_name\`; \`email\`; \`phone\` or \`whatsapp_phone\`; \`ig_username\` or \`username\`; \`message\`, \`notes\` or \`last_input_text\`; \`channel\` (instagram, facebook, tiktok, whatsapp); \`city\` or \`address\`. Fields inside a \`customData\` or \`custom_fields\` object are read too, so ManyChat's Full Contact Data and GoHighLevel's webhook payload work unchanged. Only one of name, handle, email or phone is required. The response is \`{ "ok": true, "lead_id": "…" }\`. Limits are per form (30 a minute, 300 an hour), not per sender address.

Forms can post straight from a visitor's browser. Each visitor's address is limited to 60 submissions a minute.

### Lead alerts

The top of the page has the two lead alerts: **Email me when a lead comes in** (on by default, and it keeps working even when the automations master switch is off) and **Text me when a lead comes in** (needs texting turned on). Both are covered in [Automations](help:automations#switches-on-other-settings-pages).

## Common questions

**I lost my API key. Can I see it again?** No — it's shown once. Revoke the old one and create a new key, then update the tool that uses it.

**My Zapier webhook didn't fire when I completed a job in Sollos. Why?** Webhooks currently fire only for changes made through the API or a website form, not for changes made inside the app.

**Can an API key be limited to read-only?** No. Every key can read, create, change and delete across clients, bookings, estimates and invoices. Give each tool its own key and revoke any you stop using.

**How do I know if a webhook is failing?** Look at **Last triggered** on the webhook: a red code means the receiving system answered with an error. Sollos retries timeouts and server errors twice more, but not 4xx answers.

**Someone is spamming my contact form URL. What do I do?** Press **Regenerate URL** and put the new URL in your form; the old one stops working immediately. Make sure the hidden \`website\` field is in place to catch bots.

**Do my website forms need an API key?** No. Intake forms use their own URL; API keys are for tools that read and change your data.

**Where do website leads show up?** Estimate and contact submissions become leads and requests (see [Requests](help:requests)); job applications go to **Applicants**.
`,
};
