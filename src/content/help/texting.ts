import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "texting",
  title: "Texting (SMS)",
  blurb: "Getting your own texting number, US carrier registration, client consent and STOP, what gets texted, and reading replies.",
  section: "Settings & connections",
  paths: ["/app/settings/sms", "/app/texts"],
  keywords: ["sms", "text message", "texts", "phone number", "twilio", "10dlc", "a2p", "opt in", "opt-out", "stop", "unsubscribe", "consent", "casl", "tcpa", "reply", "inbox"],
  body: `
Sollos can text clients and your team from **your own dedicated number** — not a shared line — so booking confirmations, day-before reminders and schedule changes land where people actually look. Texting is set up once at **Settings → SMS / Texting**, by an owner or admin. Email keeps working whether or not texting is on.

## Turning texting on

How you get started depends on where the business is. Sollos decides this from the country you picked under **Settings → Currency, tax & holidays → Holidays**, or, if none is picked, from your time zone.

**In Canada:** press **Enable SMS**. Sollos buys a local number straight away — in the area code of your contact phone from **Settings → Email & contact info** when one is available — and texting is on.

**In the US:** carriers block business texts until the business is registered with them, so the page shows **Register your business for US texting** instead. See the next section.

Texting needs an active Sollos plan. If your subscription has lapsed, the page links you to **Billing** instead of showing **Enable SMS**.

Once texting is on, the page shows **Your texting number**, this month's usage, the overage cap, a reminder about consent, and **Turn off SMS**.

## US registration

Fill the form in once; Sollos submits it, follows it, and buys your number and turns texting on by itself the moment the carriers approve. Approval usually takes one to three weeks.

What the form asks for:

- **The business** — **Legal business name** exactly as on the IRS letter that issued your EIN (including LLC or Inc.), the **Name customers know you by** (it starts every text), **Business type**, **EIN**, **Ownership**, **Industry**, and your **Website**. Carriers open the website to check it's live and yours; a parked or login-only page is rejected.
- **Business address**.
- **Who the carriers can contact** — an owner or officer, with an email **on your business's own domain** (carriers reject Gmail, Yahoo and similar) and a phone. The carriers may email a verification step to it.
- **What customers see** — the phone and email sent to a customer who texts HELP, plus optional links to your privacy policy and texting terms. Leave those two blank to use the pages Sollos hosts for you (below).

Press **Submit to the carriers**, or **Save for later** to come back to it. Once your EIN is saved the page shows only its last four digits.

After you submit, the page shows where it stands:

- **Carriers are checking your business (usually 1–3 days)**
- **Carriers are reviewing what you'll text (usually 1–2 weeks)**
- **Approved — texting is on**
- **Needs changes before it can be approved** — the page says what the carriers want; fix the form and submit again.

Sollos checks every hour; **Check now** asks straight away. Nothing for you to do while it waits.

The page says it plainly before you submit: **the carriers charge a registration fee for each business and a monthly fee while texting is on.** Sollos describes your texts to them as appointment confirmations, reminders, schedule changes, invoices and receipts, sent only to customers who agreed — no marketing texts.

### The texting privacy and terms pages

US carriers reject a registration whose privacy policy is missing, behind a login, or silent about sharing phone numbers, and they require a public terms page for the texting program. Plenty of small cleaning companies don't have either, so Sollos hosts both for every business, under your business name:

- a **text message privacy policy** — what's collected, that it's used only for service messages, that mobile numbers are never shared for marketing, and how to stop;
- **text message terms** — what the program is, how people sign up, frequency and cost, STOP and HELP.

They show the name and support contact from your registration (or your company profile if there isn't one). The exact links appear as hints under the two optional fields on the registration form. They're public pages that search engines are told not to index.

## Consent: double opt-in and STOP

**No client is texted without consent.** Every client-facing text checks that the client is opted in; if Sollos can't match the number to an opted-in client, it doesn't send. There are two ways a client becomes opted in:

1. **Request SMS opt-in** on the client's profile (owners, admins and managers). Sollos texts them: *"[Your business]: Reply YES to get appointment reminders & updates by text…"* When they reply YES, they're opted in and get a confirmation text. The profile then shows **Opted in to texts**; while you're waiting for their answer, the button reads **Resend SMS opt-in**. The client needs a phone number on file first, and you can send up to a hundred of these requests a day.
2. **SMS opt-in** checkbox on the client form — tick it only when the client has already given you explicit consent some other way.

Every text carries the STOP wording, and replies are handled automatically:

- **STOP** — or STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, OPTOUT, REVOKE at the start of the message — opts them out immediately and confirms: *"You're unsubscribed and won't receive more messages. Reply START to resubscribe."* It also stops shift-offer texts to that number if they're in your on-call pool. If the message says more than the keyword ("Cancel my Friday clean"), it still unsubscribes them and the words come through to you as a reply.
- **START**, **YES**, **UNSTOP** or **OPTIN**, sent on its own, opts them back in.
- **HELP** or **INFO**, sent on its own, gets your business name and contact details back.

"Yes I can take Saturday" or "Info on pricing?" is a real message, not a keyword — it goes to the office, and nothing is texted back.

## What gets texted

Turning texting on doesn't send anything by itself. Each text is a switch in [Automations](help:automations), all off until you turn them on:

- **To clients** (opted-in only): **Booking confirmation text**, **24-hour booking reminder text** (sent alongside the email reminder), **Booking rescheduled text** and **Booking cancelled text** (for opted-in clients these replace the email — one notice, not both). Invoice, overdue-reminder and receipt messages can go by text too, when that client's billing messages are set to text.
- **To your team**: **Job assignment text to employee**, the owner text when a forgotten clock-out gets capped, and **Text me when a lead comes in** on **Settings → Intake forms**.
- **Sent when you press the button**: the opt-in request above and shift offers to your subcontractors and on-call pool ([Shift offers](help:shift-offers)). These work whatever the automation switches say, as long as texting is on.

Whether a client gets email, text or both is decided per client — see [who actually receives a client message](help:automations#who-actually-receives-a-client-message). Review asks and rebooking nudges are email-only.

## Usage, cost and the cap

Texting is included in your plan up to a monthly allotment. The meter on the settings page shows **used / included** for this month. Each text is one segment; long messages count as two or more.

Segments beyond the allotment are billed at **3¢ each**, up to your **Monthly overage cap** (USD). When overage charges reach the cap, texting pauses automatically until next month, and owners and admins are told once. Change the cap and press **Save cap**. A cleared field isn't accepted, because a $0 cap would stop every text past the allotment.

**Turn off SMS** stops all texting and overage billing. Your number is kept, so turning it back on later keeps the same number.

## Text replies

When anyone texts your Sollos number back — a client, a cleaner, someone in your on-call pool — the reply is saved and put in front of the office:

- **Owners, admins and managers** get a notification in the app and a push, naming who sent it ("Text from Jane Smith (client)") and quoting the message.
- An email goes too, at most once per sender every 30 minutes, so a conversation doesn't flood your inbox. Every message is still saved.

[Text replies](/app/texts) in the sidebar (under **Comms**; under **More** on a phone) lists everything texted to your number in the last 90 days, newest first. Each row shows who sent it — matched to a client first, then a team member, then the on-call pool, linked to their profile — the time, and the message. **Text back** and **Call** open your own phone's messaging and dialer, so your reply comes from your phone, not the Sollos number. Pictures show as *Sent a picture or file*.

Owners, admins and managers can open it. Until texting is set up, the page tells you nobody can reply yet.

## Common questions

**Why didn't my client get the reminder text?** Check four things: the **24-hour booking reminder text** switch is on in Automations (and the master switch), the client is **Opted in to texts** on their profile, their notification settings include text for booking messages, and texting isn't paused at your overage cap. If any one is missing, the email still goes and the text doesn't.

**I'm in the US. Why does it say I have to register?** US carriers block business texting from unregistered companies. Fill in the registration once; Sollos turns texting on when it's approved. If you're actually in Canada, check the country under **Settings → Currency, tax & holidays → Holidays** — that's how Sollos decides.

**How long does US approval take, and what does it cost?** Usually one to three weeks. The carriers charge a registration fee and a monthly fee; the page tells you this before you submit.

**A client texted STOP by mistake. How do they start again?** They text START (or YES) on its own to your number. You can also send them a new opt-in request from their profile.

**Can I just tick the opt-in box for all my clients?** Only for clients who've genuinely agreed to texts. The safe route is **Request SMS opt-in**, which records consent when they reply YES.

**Where do I see what clients texted back?** **Text replies** in the sidebar, for the last 90 days. You'll also get a notification each time.

**Can I reply from inside Sollos?** No. **Text back** opens your own phone's messaging app with their number filled in.

**Do I need my own privacy policy?** Not for texting. Leave the two optional fields blank on the US registration and Sollos uses the privacy and terms pages it hosts for your business.
`,
};
