/**
 * The landing pages: one page per search term a cleaning company owner types
 * when they go looking for software (cleaning business software, cleaning
 * scheduling software, house cleaning / maid service software, commercial /
 * janitorial software). Rendered by src/components/landing-page.tsx.
 *
 * Same rule as the Help library: every claim here is something the app does
 * today, checked against the code and the help article it links to. A page
 * that promises a feature we don't have ranks for a while and then costs us
 * the customer at the trial. When a feature changes, its line here changes
 * in the same commit.
 */

export type LandingSection = {
  heading: string;
  body: string;
  points: string[];
  /** A help article slug (src/content/help) that explains this section in full. */
  guide?: string;
};

export type LandingPageContent = {
  slug: string;
  /** Kept under ~49 characters: the layout appends " · Sollos 3". */
  metaTitle: string;
  metaDescription: string;
  /** Short name for breadcrumbs and cross-links. */
  navLabel: string;
  kicker: string;
  h1: string;
  intro: string;
  sections: LandingSection[];
  faqs: Array<{ q: string; a: string }>;
};

const PRICE_ANSWER =
  "Starter is $49 a month for up to 5 employees and Growth is $99 a month for up to 25, both in USD and month to month. Every plan starts with a 14-day free trial, no credit card required. Bigger teams can talk to us about Enterprise.";

const CANADA_US_ANSWER =
  "Yes. You bill your own clients in CAD or USD, put your own tax label and rate on invoices (GST, HST or sales tax), and see your province's or state's statutory holidays on the schedule. Sollos subscription plans are priced in USD.";

export const LANDING_PAGES = [
  {
    slug: "cleaning-business-software",
    metaTitle: "Cleaning Business Software for Growing Crews",
    metaDescription:
      "Run your cleaning company in one place: leads and estimates, recurring scheduling, a field app for cleaners, invoicing with card payments, and payroll.",
    navLabel: "Cleaning business software",
    kicker: "Cleaning business software",
    h1: "Cleaning business software that runs the whole week",
    intro:
      "Most cleaning companies run on a calendar app, a spreadsheet of hours and a separate tool for invoices, and the gaps between them are where jobs go unbilled and hours go unpaid. Sollos 3 is one system built only for cleaning businesses: the booking becomes the cleaner's job, the job's clocked hours become payroll, and its price becomes the invoice.",
    sections: [
      {
        heading: "Win the work",
        body: "A lead from your website, a phone call or an email lands on one list. Quote it, book it, and the lead becomes a client without anyone pressing a button.",
        points: [
          "Your website's estimate and contact forms post straight into Sollos as leads",
          "Estimates go out in a click, and an approved estimate books the job itself",
          "Service contracts with an agreed price, dates and payment terms, signed online by the client",
        ],
        guide: "leads-and-clients",
      },
      {
        heading: "Schedule and dispatch",
        body: "Recurring visits generate themselves. Each cleaner sees their own jobs, arrival times and checklists on their phone, with nothing to download from an app store.",
        points: [
          "Recurring schedules that keep generating visits ahead of time",
          "Crew members arriving at different times on the same job, each with their own hours",
          "Checklists attached by service or by client, ticked off in the field app",
          "Last-minute coverage: one tap texts the shift to your subcontractors and on-call pool",
        ],
        guide: "bookings",
      },
      {
        heading: "Get paid faster",
        body: "Invoices are built from the jobs you already booked, so pricing a visit once is enough.",
        points: [
          "One invoice per visit, or one per client every week, two weeks or month",
          "Card payments through Stripe or Square, recorded against the invoice automatically",
          "Overdue reminders and receipts by email or text, on switches you control",
          "Invoices and payments sync to QuickBooks Online or Sage Accounting",
        ],
        guide: "invoicing",
      },
      {
        heading: "Pay your team right",
        body: "Cleaners clock in and out on the job from their phone. Those hours, at each person's own rate, become payroll.",
        points: [
          "Timesheets flag forgotten clock-outs and shifts that ran long, for one-tap review",
          "Payroll runs for employees and statements for subcontractors, on your pay schedule",
          "Tips split across the crew by time on the job and tracked until they're paid out",
          "Sollos prepares payroll; it never moves money on its own",
        ],
        guide: "timesheets-and-payroll",
      },
      {
        heading: "Know which jobs make money",
        body: "Every completed job shows its price against the wages clocked on it, so you can see which clients and services pay and which run long.",
        points: [
          "Margin by client and by service, and the jobs that hurt the most",
          "Hours worked against hours quoted, per job and per cleaner",
          "Paid revenue, outstanding invoices and new clients for any date range",
        ],
        guide: "reports",
      },
    ],
    faqs: [
      {
        q: "What is cleaning business software?",
        a: "Software that runs the operations of a cleaning company: booking and scheduling visits, dispatching cleaners, tracking their hours, invoicing clients and running payroll. General field service tools cover every trade from plumbing to landscaping. Sollos 3 is built for cleaning companies only, so its recurring visits, checklists, crew arrival times and tip handling fit the way cleaning work actually runs.",
      },
      {
        q: "Do my cleaners need to download an app?",
        a: "No. The field app runs in the phone's browser and can be added to the home screen like any app. Cleaners see their jobs, clock in and out, tick checklists and upload photos there.",
      },
      {
        q: "Can I switch from Jobber, Housecall Pro or a spreadsheet?",
        a: "Yes. The bulk client importer takes a CSV from any tool, and if your client list is messy, send it to support and we'll help clean it up during your trial.",
      },
      { q: "Does it work for cleaning companies in Canada and the US?", a: CANADA_US_ANSWER },
      { q: "How much does it cost?", a: PRICE_ANSWER },
    ],
  },
  {
    slug: "cleaning-scheduling-software",
    metaTitle: "Cleaning Scheduling Software for Recurring Jobs",
    metaDescription:
      "Schedule recurring cleans, crews with staggered arrival times, checklists and last-minute coverage. Cleaners get their jobs on their phones. Free 14-day trial.",
    navLabel: "Cleaning scheduling software",
    kicker: "Cleaning scheduling software",
    h1: "Cleaning scheduling software built around recurring work",
    intro:
      "A cleaning schedule isn't a calendar of one-off appointments. It's standing weekly and biweekly visits, skips and reschedules, crews that don't all arrive at once, and a cleaner calling in sick at 7 a.m. Sollos 3 schedules the way cleaning companies actually work.",
    sections: [
      {
        heading: "Recurring visits that keep themselves",
        body: "Set a client's pattern once. Sollos generates the visits ahead of time and keeps generating them.",
        points: [
          "Edit just one visit, or this visit and every one after it",
          "A skipped week is a skip, and the series carries on",
          "When a visit moves, Sollos asks whether to notify the client, then sends it by email or text",
          "Completed visits nobody has invoiced are flagged on each recurring series",
        ],
        guide: "bookings",
      },
      {
        heading: "See the whole week, or just today",
        body: "On a desk, a dispatch board per cleaner with drag-to-reschedule. On a phone, today as one timeline: tap any empty half-hour and the booking form opens at that time.",
        points: [
          "Cleaners' working hours and days off shown right on the schedule",
          "Statutory holidays labelled for your province or state",
          "The booking form names the weekday you picked and lists what's already booked that day",
        ],
        guide: "getting-around",
      },
      {
        heading: "Crews, not just cleaners",
        body: "Put several people on one job and give each their own arrival time and time on site: 9:00 for six hours, 11:00 for six, 1:00 for five. Each cleaner's phone shows their own time, and each clocks their own hours.",
        points: [
          "Cleaners confirm each shift, with the date spelled out so nobody accepts the wrong day",
          "Unconfirmed shifts are chased the day before and two hours out, then flagged to the office",
          "Pay comes from each person's own clocked hours",
        ],
        guide: "timesheets-and-payroll",
      },
      {
        heading: "Last-minute coverage in one tap",
        body: "When someone calls in sick, Offer shift texts a claim link to your own subcontractors and your on-call pool at once. The first to tap gets the job, and they show up on the booking.",
        points: [
          "Your subcontractors are paid their usual rate",
          "On-call cleaners are paid the flat amount on the offer",
        ],
        guide: "automations",
      },
      {
        heading: "Every visit done the same way",
        body: "Checklists attach themselves, so the right list is on the job before the cleaner arrives.",
        points: [
          "Attach by service, for every booking of that service, or by client, for one home's quirks",
          "Before, during and after phases, with required items that stand out",
          "A client's note for a single visit lands on the cleaner's job screen",
        ],
        guide: "checklists",
      },
      {
        heading: "Reminders that go out on their own",
        body: "Turn on the messages you want and Sollos sends them on schedule.",
        points: [
          "Booking confirmations, reschedule notices and a reminder the day before",
          "Each client chooses email, text, both or nothing",
          "Texts only go to clients who opted in, and STOP always works",
        ],
        guide: "automations",
      },
    ],
    faqs: [
      {
        q: "Can I schedule recurring cleaning appointments?",
        a: "Yes. Set the pattern on the booking and Sollos generates the visits ahead of time, keeps generating them, and lets you change one visit or the whole series from any date forward.",
      },
      {
        q: "What happens when a client skips a week?",
        a: "Mark that visit as a skip and the series carries on. Clients can also skip from their own portal: far enough ahead it simply happens and you're told; close in, it comes to you as a request to approve or decline.",
      },
      {
        q: "Can cleaners see their schedule on their phone?",
        a: "Yes. Each cleaner sees their own jobs, arrival times, addresses and checklists in the field app, which runs in the phone's browser with nothing to install.",
      },
      {
        q: "Does it sync with Google Calendar?",
        a: "Yes. Google Calendar sync is included on every plan.",
      },
      {
        q: "How do I cover a job when a cleaner calls in sick?",
        a: "Use Offer shift on the booking. It texts a claim link to your subcontractors and your on-call pool at the same time, and the first person to tap it is put on the job.",
      },
      { q: "How much does it cost?", a: PRICE_ANSWER },
    ],
  },
  {
    slug: "house-cleaning-software",
    metaTitle: "House Cleaning & Maid Service Software",
    metaDescription:
      "Software for house cleaning and maid services: recurring home cleans, checklists for each house, a client portal, website booking requests and card payments.",
    navLabel: "House cleaning & maid service software",
    kicker: "House cleaning & maid service software",
    h1: "Software for house cleaning and maid services",
    intro:
      "Residential cleaning is personal: the buzzer code, the dog, the room that's never to be touched. It's also repetitive, with the same homes every week or two. Sollos 3 remembers the details so your cleaners don't have to, and handles the repetition so you don't.",
    sections: [
      {
        heading: "Every home's quirks, on every visit",
        body: "What makes one house different from the next lives on the client's record and travels to every booking.",
        points: [
          "Standing notes on the client: buzzer codes, pets, parking",
          "A checklist for one home (\"feed the fish\", \"double-lock the side door\") on every visit there",
          "Several properties under one client",
          "Book again with the service, length and price from the last visit already filled in",
        ],
        guide: "leads-and-clients",
      },
      {
        heading: "New clients from your own website",
        body: "Connect your website's estimate and contact forms and every submission arrives in Sollos, ready to quote or book.",
        points: [
          "Each submission becomes a lead, with a draft estimate for estimate requests",
          "The visitor gets a branded confirmation; you get an email, and a text if you want one",
          "Repeat submissions from the same email update one lead instead of piling up duplicates",
        ],
        guide: "website-forms",
      },
      {
        heading: "A client portal that takes the calls for you",
        body: "Clients help themselves to the small stuff, and it reaches you as tidy requests instead of interruptions.",
        points: [
          "Clients see their upcoming and past visits",
          "A note for one visit goes straight to the cleaner's job screen",
          "Skip a visit or request a new booking, which lands in your Requests ready to schedule",
          "Leave a review after any clean",
        ],
        guide: "client-portal",
      },
      {
        heading: "Reminders, reviews and rebooking on autopilot",
        body: "The messages that keep homes on your schedule go out without anyone remembering to send them.",
        points: [
          "Booking confirmations and a reminder the day before",
          "Review requests at a pace you set, and a Google review ask after a client's first clean",
          "Rebooking nudges for clients with nothing on the calendar",
          "Each client chooses email, text, both or nothing",
        ],
        guide: "automations",
      },
      {
        heading: "Paid by card, tips included",
        body: "Each visit drafts its own invoice, sent on the rhythm you choose: the day after the job, after a review window, or once a week.",
        points: [
          "Clients pay online by card through Stripe or Square, and can add a tip",
          "Tips are split across the crew by time on the job and tracked until they're paid out",
          "Overdue reminders and receipts go out on their own",
        ],
        guide: "invoicing",
      },
    ],
    faqs: [
      {
        q: "What is maid service software?",
        a: "Software built for residential cleaning companies: recurring home visits, the notes and checklists for each house, appointment reminders, online payments and paying your cleaners. Sollos 3 covers all of it, for house cleaning teams from one owner to dozens of cleaners.",
      },
      {
        q: "Can clients book online?",
        a: "Clients with a portal login can request a booking (service, preferred date and time window, address and notes) and it lands in your Requests for you to confirm. New clients reach you through your website's estimate and contact forms, which post straight into Sollos. You stay in control of the schedule.",
      },
      {
        q: "Can clients tip their cleaner?",
        a: "Yes. Clients can add a tip when they pay by card. Sollos splits it across the crew by their time on the job and keeps a ledger of what's still owed to each cleaner until it's paid out.",
      },
      {
        q: "Is it right for a solo cleaner or a small team?",
        a: "Yes. Starter is built for solo owners and small crews: up to 5 employees for $49 a month (USD), with a 14-day free trial and no card required.",
      },
      { q: "Does it work in Canada and the US?", a: CANADA_US_ANSWER },
    ],
  },
  {
    slug: "commercial-cleaning-software",
    metaTitle: "Commercial Cleaning & Janitorial Software",
    metaDescription:
      "Janitorial and commercial cleaning software: signed service contracts, site checklists, crew clock-in with lateness flags, monthly billing and job profitability.",
    navLabel: "Commercial & janitorial software",
    kicker: "Commercial cleaning & janitorial software",
    h1: "Commercial cleaning and janitorial software",
    intro:
      "Commercial work runs on contracts, not one-off visits: the same buildings on a set schedule, at a fixed price, billed monthly to a company that wants to know the work got done. Sollos 3 keeps the contract, the crew, the record and the invoice in one place.",
    sections: [
      {
        heading: "Contracts and quotes",
        body: "Quote the building, win it, and put the agreement on record.",
        points: [
          "Estimates that turn into booked work when the client approves them",
          "Service contracts with an agreed price, start and end dates and payment terms",
          "Clients sign contracts online, and service agreements stay on the client's record",
        ],
        guide: "leads-and-clients",
      },
      {
        heading: "Every site, every standard",
        body: "Each building's requirements go to the crew on every visit, not just the first one.",
        points: [
          "Several properties under one client account",
          "A site checklist on every visit for that client, ticked off by the crew",
          "Photos from the job, uploaded from the cleaner's phone",
          "Standing access notes: codes, keys, who to call",
        ],
        guide: "checklists",
      },
      {
        heading: "Know your crew showed up",
        body: "Cleaners clock in and out on the job from their phone, and the hours land in timesheets as they happen.",
        points: [
          "Late arrivals marked on the timesheet",
          "Shifts that ran long or never clocked out flagged for review",
          "Assigned jobs with no clock-in flagged beside each cleaner in reports",
          "Payroll for employees and statements for subcontractors, from the same hours",
        ],
        guide: "timesheets-and-payroll",
      },
      {
        heading: "Billing the way companies pay",
        body: "Put a client on a weekly, biweekly or monthly billing cycle and one invoice covers every visit in it.",
        points: [
          "Bill a company for visits to several sites or people on one invoice",
          "Bill for any date range in a couple of clicks, without double-billing a visit",
          "Card payments through Stripe or Square, or record a cheque or transfer by hand",
          "Invoices and payments sync to QuickBooks Online or Sage Accounting",
        ],
        guide: "invoicing",
      },
      {
        heading: "Bid with real numbers",
        body: "Job profitability puts each completed job's price against the wages clocked on it, so you can see which contracts pay before you renew them.",
        points: [
          "Margin by client and by service",
          "Hours worked against hours quoted, with jobs running over turning amber",
          "The jobs with the thinnest margins, listed for a closer look",
        ],
        guide: "reports",
      },
    ],
    faqs: [
      {
        q: "What is janitorial software?",
        a: "Software for companies that clean offices, buildings and other commercial sites on contract: scheduling recurring visits, sending crews with the right site checklist, confirming the work was done, billing the client on a cycle, and paying the crew. Sollos 3 handles all of it, alongside residential work if you do both.",
      },
      {
        q: "Can I bill commercial clients monthly?",
        a: "Yes. Put the client on a weekly, biweekly or monthly billing cycle and Sollos issues one invoice for every visit in the period. You can also bill any date range by hand, and visits already on a draft fold in without being billed twice.",
      },
      {
        q: "How do I know my cleaners were on site?",
        a: "Cleaners clock in and out on the job from their phone. Timesheets mark late arrivals and flag shifts that ran long or never clocked out, and reports count the jobs where nobody clocked in at all.",
      },
      {
        q: "Can I use subcontractors?",
        a: "Yes. Subcontractors are paid their rate for their clocked hours through statements, separate from employee payroll. When you need coverage, Offer shift texts the job to your subcontractors and on-call pool at once.",
      },
      {
        q: "Does it handle residential cleaning too?",
        a: "Yes. Many cleaning companies do both, and Sollos runs residential and commercial clients side by side.",
      },
      { q: "How much does it cost?", a: PRICE_ANSWER },
    ],
  },
] as const satisfies ReadonlyArray<LandingPageContent>;

export type LandingSlug = (typeof LANDING_PAGES)[number]["slug"];

export function getLandingPage(slug: LandingSlug): LandingPageContent {
  // The slug type only admits real pages, so this always finds one.
  return LANDING_PAGES.find((p) => p.slug === slug)!;
}
