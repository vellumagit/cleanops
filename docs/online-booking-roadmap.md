# Online booking: roadmap

Written 2026-11-19. Status: plan only, nothing built.

## The goal

Each company on Sollos gets one branded link (for example
`sollos3.com/book/svit`) that it hands to anyone. A visitor picks a service,
picks an open time, types their details and is booked, without creating a
login. The company controls what is offered and when through its own settings.
Reference points: Acuity and Jane.

Everything here is off for a company until it switches it on, so each phase can
ship and be tried on Velluma without touching Svit.

## How a client gets in

Decided 2026-11-22. The aim is that a client of any age never has to
remember an address or a password, and never has to be "set up" first.

### Three doors, one place

1. **The link in a message they already have.** Every email and text a client
   gets about a visit, an invoice or an estimate carries one button that
   opens that exact thing. No sign-in. This is the door most people will use,
   because they are already looking at the message.
2. **The cleaner's own page**, `sollos3.com/book/<name>`. The company's logo
   and two large buttons: **Book a clean** and **My cleans**. This is what
   goes on the cleaner's website, cards and fridge magnets.
3. **The Sollos front page**, for someone who only remembers "it's that
   Sollos thing". One line, "Here to see your cleaner?", leads to a page that
   asks for their email and nothing else.

All three end in the same client area.

### Signing in without a password

- The client types their email. They get an email with one button. Pressing
  it signs them in. There is no password to choose, remember or reset.
- If the email is on file with two companies, they are asked which one.
- A text message with a 6-digit code is the same idea for people who live in
  their texts; it comes after the email version.

### What has to change from today

Today's portal is close but has two gates that get in the way:

- **A client must be invited first.** Only a client the office has invited
  can sign in; anyone else types their email and nothing happens. Change: any
  client whose email is on the company's books can sign in. Proving they own
  the email is the permission. The invite button stays, as a way to send the
  link, not as a gate.
- **The first visit asks for a password.** The invite link opens a "choose a
  password" page. Change: the invite link signs them straight in. A password
  stays possible for the few who want one, behind "sign in another way".

Nothing is lost on safety: a link sent to an email address already proves
more than a password someone picked.

### What they can do without signing in at all

From the private link in a message, for that one item only:

- a visit: see when it is and who is coming, confirm it, ask to move or
  cancel it
- an invoice: see it, pay it, tip (exists today)
- an estimate: approve or decline it (exists today)

Signing in is only needed to see everything together: all visits, all
invoices, saved addresses, booking again.

### Rules for the screens

- One job per screen, one main button per screen.
- Large text and buttons; made for a phone held in one hand.
- The company's name, logo and colour throughout. Sollos is not the brand
  the client sees.
- Plain words: "My cleans", "Book a clean", "Pay". No "portal", no
  "dashboard", no "account".
- Every screen says who to call, with the company's phone number, for anyone
  who would rather talk to a person.

## Nothing is created automatically

Decided 2026-11-19. A company has no booking page until it goes and makes one.

- **No page by default.** Signing up, or this feature shipping, creates nothing
  public. Until a company sets one up, its link does not exist: the address
  answers "not found", the same as a name nobody has taken.
- **The company claims its link.** In Settings → Online booking the first step
  is choosing the personalised name (`sollos3.com/book/<name>`). The short name
  from signup is offered as a suggestion, not used on its own, and the company
  can pick a different one. The name must be free, and a list of reserved words
  is refused.
- **Build it as a draft.** Description, which services show, prices, and (from
  phase 2) hours and rules are all filled in while the page is unpublished.
- **Preview before anyone sees it.** A "Preview" button shows the page exactly
  as a visitor would get it, to signed-in office staff of that company only.
  Nobody else can open a draft.
- **Publish and unpublish.** One switch makes the link live. Switching it off
  takes the page down again and keeps everything that was set up. Bookings
  already made stay as they are.
- **Changing the name later.** Allowed, with a warning that the old link stops
  working for anyone who saved it. Whether the old name redirects for a while
  is an open question.

Three states, then: not set up, draft, published.

## What already exists

| Piece | Where | Use for this |
| --- | --- | --- |
| Unique short name per company (`organizations.slug`) | set at signup, used by no route yet | the link |
| Logo, brand colour, time zone, currency, contact email and phone | `organizations` | the page's look |
| Services with a default length and price | `service_types`, Settings → Services | what can be booked |
| Packages and add-ons | `packages`, `src/lib/service-extras.ts` | later phases |
| Each cleaner's weekly hours, one-off days, time off | `availability_slots`, `availability_overrides`, `pto_requests` | open times |
| Holidays | `src/lib/holidays.ts` | open times |
| A database guard that refuses overlapping visits for a cleaner | `20261115010000_overlap_guard_whole_crew.sql` | last line of defence against double booking |
| "Find this person or create them" by email | `src/lib/find-or-create-client.ts` | guest becomes a client |
| Requests from the portal and an office screen to approve them | `booking_requests`, `/app/bookings/requests` | approval mode |
| Public forms with spam protection | `/api/contact-request`, honeypot, rate limits, Turnstile on signup | guest form safety |
| Confirmation, reminder, reschedule and cancel emails and texts | `src/lib/email-templates.ts`, `src/lib/twilio.ts` | after booking |
| Online card payment, on invoices only | Stripe Connect, `/i/[token]` | deposits later |

## What is missing

1. The public page itself.
2. Anything that works out open times. Today's code only answers "do these
   two visits clash for this person"; nothing lists free slots.
3. Company-level booking rules: opening hours, how far ahead, minimum notice,
   gap between jobs, how many jobs at once.
4. A switch per service for "can be booked online", and a public description.
5. A service area. The company has no address or area on file.
6. A way for the client to reschedule or cancel from a link. Today's
   confirmation says "reply to this email".
7. Taking a deposit or card at booking time.

## The hard parts

These are where the care goes. Each has a recommended answer.

**How long is the job.** An appointment in Acuity has a fixed length. A clean
depends on the home. Recommendation: a service offered online must have a fixed
length and price, or a short list of sizes (for example 1 to 2 bedrooms, 3
bedrooms, 4 or more), each with its own length and price. Anything else is
offered as "request a quote". Note that a booking's length in Sollos is the
one-person estimate, so the slot length for a two-person crew is half of it.

**Who does the job.** The double-booking guard works per cleaner. A visit with
nobody assigned clashes with nothing, so ten of them could land on one morning.
Recommendation: the company picks which cleaners take online bookings. A time
is open only when enough of them are free, and the booking is given to one of
them straight away (fewest jobs that day first). The office can change it.

**Two people taking the same time.** The slot is checked again inside the save,
and the database guard refuses the loser, who is shown the next open times.

**Instant or approved.** Recommendation: both, as a setting, with "ask me
first" as the default. In that mode the visit is saved as pending and holds the
time until the office confirms or declines. That is what stops a second visitor
taking it.

**Travel.** No travel data exists. Recommendation: a single "gap between jobs"
setting (for example 30 minutes) in the first version, nothing cleverer.

**Spam and fake bookings.** A form with no login that writes to a real
calendar will be abused. Turnstile on the last step, limits per address and per
email, the existing throwaway-email and card-number checks, and in instant mode
an optional "confirm by email within 15 minutes or the time is released".

**Privacy.** A guest who types an existing client's email must learn nothing
about that client: no saved address, no price, no history. Matching happens
quietly on the server after the booking is made.

**Time zones.** All times are worked out on the server in the company's zone,
never on the visitor's device. The save already refuses when the server's zone
rules are stale; the slot list must do the same.

**Recurring cleans.** Not in the first versions. A guest books one visit; the
office turns it into a series. Revisit in phase 6.

## Phases

Each phase ends in something usable and is tested before the next starts.

### Phase 0: the front doors (small to medium, do first)

Makes what exists today easy to get into, before anything new is offered.
See "How a client gets in".

- Sign in by emailed link for any client on the books: no invite needed, no
  password asked for.
- The invite link signs the client straight in.
- "Manage this visit" in every booking email and text: a private link to
  that visit, where the client can confirm it or ask to move or cancel it.
  Asking sends the office a request; picking a new time themselves comes
  with phase 4, once open times exist.
- "Here to see your cleaner?" on the Sollos front page.
- The client area reworded and resized to the screen rules above.

Needs no slot logic and no company page, so it helps Svit's existing
clients straight away.

### Phase 1: the company page, with requests (small)

- `/book/[slug]`: logo, colour, short description, services marked as public,
  contact details, **Sign in** for existing clients.
- **Request a clean** as a guest: service, preferred day and part of day,
  address, name, email, phone. It creates the person as a lead and a row in the
  existing requests screen, so the office flow is unchanged.
- Settings → Business → **Online booking**: claim the link name, build the
  page as a draft (description, which services show), preview it, publish or
  unpublish it. Once published: the link with a copy button and QR code. See
  "Nothing is created automatically" above.
- "Manage your cleans" link added to client emails; a "Here because your
  cleaner uses Sollos?" line on the marketing site.

Ships real value on its own and needs no slot logic.

### Phase 2: open times (medium, the core)

- Settings: opening hours per weekday, earliest notice, how far ahead, gap
  between jobs, which cleaners take online bookings, slot step (30 or 60
  minutes).
- One function that returns open times for a service on a day. It has no
  database access of its own, so it can be tested exhaustively: weekly hours,
  one-off days, time off, holidays, existing visits, gaps, crew size, day
  boundaries and clock changes.
- An office-only preview, "what a visitor would see this week", so the owner
  can check it against the real calendar before anything is public.

Nothing public changes in this phase.

### Phase 3: booking a time as a guest (medium)

- The page gains the picker: service (and size), day, open time, details,
  confirm.
- Saves a real visit, pending or confirmed by the company's setting, assigned
  as described above, with the existing confirmation email and text.
- The office sees it marked "Booked online"; a notice goes to the owner.
- Spam protection and the race check from the section above.
- Load test: many visitors taking the same slot at once, on the local
  Postgres, never on production.

### Phase 4: change or cancel from a link (small to medium)

- Every confirmation and reminder carries a private link to that one visit.
- The client can move it to another open time or cancel, inside a notice
  period the company sets. Past that, the page says to contact the company.
- The office is told of every change.

### Phase 5: money (medium)

- Optional deposit or full payment at booking through the company's Stripe
  connection; the visit is held unpaid for a few minutes, then released.
- A cancellation policy shown before paying; what happens to the deposit on a
  late cancel is the company's setting.
- Square is not covered in this phase.

### Phase 6: reach (each item separate)

- A button and an embeddable version for the company's own website.
- `name.sollos3.com` or the company's own domain.
- Signed-in clients rebook with their saved address and their own price.
- Recurring bookings by the client.
- Packages and add-ons in the picker.

## Decisions needed before phase 1

1. The address: `sollos3.com/book/svit` (recommended) or another word.
2. Whether prices show publicly: fixed price, "from" price, or hidden, set per
   service (recommended) or one rule for the whole company.

## Decisions needed before phase 3

3. Default mode for a new company: ask me first (recommended) or instant.
4. Assignment: give the visit to a free cleaner at once (recommended) or leave
   it for the office with a cap on jobs per time.
5. Which plan includes online booking, if it is not on every plan.

## Not decided, not researched

- How Jane handles the same problems. This plan is drawn from Acuity's public
  help pages and from the Sollos code, not from Jane.
- Whether Svit wants this. It is designed so a company that never switches it
  on sees no change.
