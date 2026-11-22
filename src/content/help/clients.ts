import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "clients",
  title: "Clients",
  blurb: "The client list, adding and importing clients, everything on a client's profile, statements, archiving and deleting.",
  section: "Clients & sales",
  paths: [
    "/app/clients",
    "/app/clients/new",
    "/app/clients/[id]",
    "/app/clients/[id]/edit",
    "/app/clients/import",
    "/app/clients/[id]/statement",
  ],
  keywords: ["customer", "customer list", "client list", "directory", "roster", "all clients", "contact", "address book", "csv", "spreadsheet", "import", "statement of account", "archive", "properties", "door code", "billing day", "sms consent"],
  body: `
A client is someone you clean for. Their record holds who they are, where you clean, how they want to hear from you, and how they're billed. Their bookings, invoices, estimates, and reviews all hang off it. People who have asked but not booked yet are on the Leads page instead (see [Leads](help:leads-and-clients)).

## Who can do what

- **Owners, admins, and managers** with **Client records** access can open Clients, view and edit profiles, add properties, upload documents, email clients, and send texting opt-in requests.
- **Only owners and admins** can import a spreadsheet, invite a client to the portal, and archive or restore a client. The **New client** and **Import CSV** buttons on the list only show for owners and admins.
- A manager whose **Invoices & estimates** access is off can still see clients, but not their balance, invoices, or estimates.

## The client list

[Clients](/app/clients) (sidebar → **People** → **Clients**) shows your active clients with their email, phone, how they get notifications, and their balance. Search by name, email, or phone. Click a row to open the profile, or press **Book** on a row to start a booking for that client.

The **Notifications** column shows each client's setting at a glance: your default (for example "Email"), **Custom**, or **No contact**. A ⚠ means your default includes texts but this client hasn't agreed to receive them.

## Adding a client

1. On the client list, press **New client**.
2. Fill in **Name**. Everything else is optional.
3. Press **Create client**.

The fields:

- **Company name**: for a client who runs a business. Invoices, statements, and receipts are addressed to the company, with the name above as the contact. Bookings, the schedule, and texts keep using their name.
- **Email** and **Phone**.
- **SMS opt-in**: tick this only after the client has told you they agree to booking confirmation and reminder texts. Sollos won't text a client until this is on. See [Texting consent](help:clients#texting-consent).
- **This customer has already left us a Google review**: shown only when you add a client. Ticking it means the automatic Google review request never goes to them. They still get the normal review email after each job.
- **Address**: suggestions appear as you type.
- **Notifications**: see [How a client hears from you](help:clients#how-a-client-hears-from-you).
- **Preferred cleaner**: fills in the cleaner on new bookings for this client. Leave it blank to pick each time.
- **Notes**: standing notes, shown on the profile.
- **What do they want?**: the lead's original request. It's filled in by the leads quick-add and your website forms.
- **Referred by**: which existing client sent them. When you pick one, owners and admins get a "Say thank you" notification.
- **Billing cadence**: see [Billing settings](help:clients#billing-settings).

## The client profile

Open a client to see their profile. The buttons along the top:

- **Statement**: a printable account statement (see [Statements](help:clients#statements)).
- **Invite to portal**: owners and admins only (see [The client portal](help:clients#the-client-portal)).
- **Email client**: write to them from Sollos (see [Emailing a client](help:clients#emailing-a-client)).
- **New invoice**: opens an invoice for this client. A number on the button tells you how many completed jobs aren't on any invoice yet.
- **New estimate** and **New booking**: open those forms with this client already picked. A new booking also fills in their address.
- **Edit**: the full client form.

Below that:

- **The client card**: email, phone, texting consent, address, **Balance owing**, notes, who referred them, and when they became a client.
- **Properties**: the places you clean for them.
- **Notifications**: what this client actually receives, by type.
- **Bookings, Invoices, Estimates, Reviews**: counts for this client. Click Bookings, Invoices, or Estimates to open that list filtered to this client.
- **Google review status**: where they are in the Google review requests.
- **Recent bookings**: the last ten. A completed job has a book-again icon that opens a new booking copied from it, so you only pick the date.
- **Recent invoices** and **Recent estimates**: the last ten of each. When there are more, the heading says "Showing 10 of 20" and **View all** opens the full list.
- **Home photos & videos**, **Documents**, **Sent emails**, and **Reviews**.
- **Done with this client?**: the archive button (owners and admins).

## Properties

**Properties** lists the places you clean for this client. Most clients have one. For a client with several places, each job picks one.

Press **Add property** and fill in:

- **Name**: what you and the cleaners call it, for example "Whyte Ave suite". This is what shows on the job.
- **Address**.
- **Getting in**: lockbox codes, where the key is, parking. Cleaners see this on the job screen.
- **Notes**: anything else about the place.

The pencil edits a property. The archive icon takes it out of the booking form. Its past and upcoming jobs stay exactly as they are.

## How a client hears from you

The **Notifications** control on the client form decides which automatic messages this client gets and how. There are three choices:

- **Follow default**: uses your company setting from **Settings → Client messages → Default client notifications** (email only, text only, email and text, or none).
- **Custom**: pick **Off**, **Email**, **Text**, or **Both** for each type of message: **Booking updates** (confirmations, reminders, changes), **Billing** (invoices, receipts, overdue notices), and **Reviews & rebooking** (follow-ups).
- **Do not contact**: no automatic messages of any kind. You can still email or text them yourself.

Under the choices, a line tells you what will actually be sent. The card on the profile shows the same thing. If a choice can't be delivered, it says why:

- Texts won't send until the client has agreed to texts.
- Texts won't send until texting is turned on for your company (see [Texting](help:texting)).
- Review and rebooking messages are email only. **Text** sends nothing for them, and **Both** sends just the email.
- Email can't be sent without an email address.

> Do not contact only stops messages. The client still gets invoiced, and their bookings still complete as usual.

## Texting consent

Sollos only texts a client who has agreed to receive texts. You can record that two ways:

- **Tick SMS opt-in** on the client form, once the client has told you they agree.
- **Request SMS opt-in** on the profile, under their phone number. This texts the client asking them to reply YES. They're opted in only when they reply. Until then the profile shows "Opt-in requested — awaiting reply", and the button changes to **Resend SMS opt-in**.

Requesting needs a phone number on the client and texting turned on for your company. Each company can send up to 100 opt-in requests a day. Once a client is opted in, the profile shows **Opted in to texts**.

## Google review status

This panel shows where the client is in the automatic Google review requests (see [Reviews](help:reviews)). Possible states are **Not asked yet**, **Asking**, **Clicked ✓**, **Reviewed ✓**, **Opted out**, and **Stopped (no response)**.

Owners, admins, and managers can change it:

- **Mark reviewed**: they've already reviewed you, so no more requests go out.
- **Stop asking**: no more requests go out.
- **Resend now**: send the next reminder now.
- **Reset**: start the requests over.

**Reset** and **Resend now** need an email on the client and your Google review link saved in [Settings → Branding](/app/settings/branding). Until both are set, those buttons are greyed out and the panel tells you which one is missing.

## Documents and photos

**Documents** holds the paperwork for this client in three groups: **Signed invoices**, **Contracts & agreements**, and **Other**. Press **Add file** in a group to upload a PDF or image (up to 20 MB). Each file has **Open**, **Download**, and **Delete**.

**Home photos & videos** holds pictures and videos of the place itself: what the client sent for a quote, where the key is, what it looked like before your first visit. Everyone on the team sees them on this client's jobs. See [Bookings](help:bookings#photos).

## Emailing a client

**Email client** (top of the profile) writes to the client from Sollos. Add a subject and a message, tick any files from their **Documents** card to attach, and add files from your device if you like. **Keep added files in Documents** is ticked unless you untick it. The email goes to the address on their profile, with your logo and contact details, and replies go to your company's contact inbox.

Every email you send this way is listed under **Sent emails** on the profile, with what was attached and who sent it, so anyone in the office can see what the client was told. Automatic emails (invoices, reminders, estimates) aren't listed there. You'll find those on the invoice, booking, or estimate that sent them.

Limits that stop the button being misused:

- **Email client** unlocks a day after a company is created.
- You can send at most five emails to one client per day.
- Every company has a daily cap on all outgoing email: 50 a day in its first week, 500 after that. Sollos support can raise it for a business that needs more.
- An archived client can't be emailed, and neither can an address that bounced or unsubscribed earlier.

## Billing settings

The **Billing cadence** section of the client form decides when this client's invoices are made. It's hidden while someone is still a lead.

- **Invoice frequency**: **On demand** (one invoice per completed job, the default), **Weekly**, **Biweekly**, or **Monthly**. Weekly, biweekly, and monthly combine the period's completed jobs into one invoice.
- **Monthly billing day**: for monthly clients. The cycle turns over on this day, so 15 bills the 15th through the 14th. Leave it blank for the calendar month. You can pick 1 to 28.
- **Weekly / biweekly cycle start**: exact 7- or 14-day cycles counted from this date. The first invoice goes out one full cycle after it. Weekly clients need it. Biweekly clients can leave it blank to be billed on the 1st and 15th.
- **Line-item style**: **Itemized** lists each completed job. **Flat rate** charges a fixed amount however many jobs ran.
- **Flat rate (per period)**: the fixed amount, in dollars. Leave it blank to add up the job totals instead.

How the billing run works is in [Billing cycles](help:billing-cycles).

## Editing a client

Press **Edit** on the profile, change what you need, and press **Save changes**.

- **Changing the address** updates their upcoming visits too. Visits that haven't started yet and still have the old address move to the new one, and so do their recurring schedules. A visit with a different address typed on it is left alone. So are past visits, and visits tied to one of the client's properties. After saving, a message says how many visits moved and how many were left for you to check.
- **Changing the name** updates the name on their upcoming jobs in Google Calendar.
- **Turning SMS opt-in off** removes their texting consent.

## The client portal

The portal lets a client see their visits and invoices, leave notes, skip a visit, and ask for a booking. Owners and admins invite a client with **Invite to portal** on the profile, or from the **Client portal** card on the edit page. The client needs an email address first. After that, the button shows **Invite pending** while you wait, **Resend invite** if the invite expired, and **Portal active** once they've signed up. See [The client portal](help:client-portal).

## Importing from a spreadsheet

Owners and admins can add many clients at once from a CSV file:

1. On the client list, press **Import CSV**.
2. Choose your file (CSV only, up to 5 MB). It needs a header row.
3. Press **Import clients**.

The columns Sollos reads (upper or lower case both work):

- **name**: required. Also accepted: full_name, client, client_name.
- **email**: also email_address, e_mail.
- **phone**: also phone_number, mobile, cell.
- **address**: also street, location.
- **preferred_contact**: email, phone, or sms. Also contact_method, contact.
- **notes**: also note, comment, comments.

Other columns are ignored.

**Duplicates are skipped.** A row is a duplicate when its name, email, and phone all match a client you already have, or another row in the same file. The result tells you how many clients were added and how many duplicates were skipped.

**Skipped rows:** a row is skipped if it has no name, has an invalid email, or has a disposable (throwaway) email address. Click **rows had warnings** to see which rows and why.

A new company can add 200 clients a day, and an established one 2,000. If a file is bigger than that, import it in parts, or ask Sollos support to raise the limit for a real client list.

> Imported clients aren't opted in to texts. Get their consent first, then tick **SMS opt-in** or send **Request SMS opt-in**.

## Statements

**Statement** on the profile opens an **Account Statement** for the client. It shows your company name and contact details, the client's details, **Total Charged**, **Total Paid**, and **Balance Owing**, then every invoice on file with its date, status, amount charged, amount paid (minus any refunds), and balance. Press **Print / Save PDF** to print it or save it as a PDF to send.

## Archiving a client

When you're done with a client, use **Archive client** at the bottom of their profile (owners and admins). Before it does anything, it tells you exactly what will happen:

- Their open bookings are cancelled. That includes everything upcoming, plus anything from the last two weeks still not done, but never a job that a live invoice already bills. Assigned cleaners are told about cancelled jobs that hadn't happened yet, and those come off the calendar.
- Their recurring schedules and recurring invoices stop.
- Their portal sign-in is locked.
- They disappear from every list, picker, and billing run.

What stays: their history, documents, and any **unpaid invoices**. Archiving a client never cancels what they owe, so you can still collect it.

Archived clients are behind **Show archived** on the client list. **Restore client** brings them back, including their portal access, but not the cancelled bookings or stopped schedules. Turn those back on yourself if the client returns.

## Deleting a client

**Delete client** is under **Danger zone** on the edit page. It's for duplicates and mistakes only: it works only when the client has no bookings, invoices, estimates, or contracts. If any exist, Sollos lists them with links and tells you what to remove first. An invoice with a payment on it needs the payment deleted before the invoice can go, and a voided invoice still counts as a record. For a real client you're done with, use **Archive** instead. The same panel has a button for it.

## Common questions

**Why can't I see the New client or Import CSV buttons?** They only show for owners and admins.

**I changed a client's address. Did their visits change too?** Upcoming visits with the old address did. The message after saving says how many moved and how many kept a different address. Open those to check them.

**Why isn't my client getting texts?** Check the **Notifications** card on their profile. It says exactly why nothing is going out: the client hasn't agreed to texts, texting isn't turned on for your company, or that message type only exists as email.

**How do I stop all automatic messages to one client?** Edit them, set **Notifications** to **Do not contact**, and save. Invoicing and bookings carry on as normal.

**Why won't Sollos let me delete this client?** They have bookings, invoices, estimates, or contracts on record. Archive them instead, or remove each listed record first.

**I archived a client by mistake. Can I undo it?** Press **Show archived** on the client list, open them, and press **Restore client**. Bookings that the archive cancelled stay cancelled, so rebook any you still need.

**Where do I set a client's monthly billing day?** On their edit page, under **Billing cadence** → **Monthly billing day**.

**The import skipped someone I expected to be added.** Click **rows had warnings** in the result. A row is skipped when it has no name, has an invalid or disposable email, or has the same name, email, and phone as a client you already have.
`,
};
