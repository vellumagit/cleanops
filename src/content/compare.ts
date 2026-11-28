/**
 * Comparison pages: "<competitor> alternative" searches, one page per
 * competitor. Rendered by src/components/compare-page.tsx.
 *
 * Two rules, both stricter than the landing pages:
 *
 * 1. Every Sollos claim is something the app does today, checked against the
 *    code (same rule as src/content/landing.ts). Where we fall short, the page
 *    says so in "better if" and in the table. A comparison page that oversells
 *    loses the reader at the trial and loses trust before that.
 *
 * 2. Every competitor claim is what the competitor's own pricing page says,
 *    on the date in `checkedOn`. Their prices change often: re-check each
 *    quarter, and update `checkedOn` in the same commit. A stale competitor
 *    price is the fastest way to lose a reader on a comparison page.
 */

export type ComparePageContent = {
  slug: string;
  /** The competitor's name as they write it. */
  competitor: string;
  /** Kept under ~49 characters: the layout appends " · Sollos 3". */
  metaTitle: string;
  metaDescription: string;
  /** Short name for breadcrumbs, the footer and cross-links. */
  navLabel: string;
  kicker: string;
  h1: string;
  intro: string;
  /** When the competitor's prices and plan gates were last read off their site. */
  checkedOn: string;
  /** Where those prices were read, shown under the price table. */
  source: { label: string; href: string };
  price: {
    heading: string;
    intro: string;
    columns: readonly [string, string, ...string[]];
    rows: ReadonlyArray<{ team: string; cells: readonly string[] }>;
    notes: readonly string[];
  };
  whySwitch: ReadonlyArray<{ heading: string; body: string }>;
  everyPlan: readonly string[];
  betterIf: { intro: string; points: readonly string[]; outro: string };
  /** Feature, what Sollos does, what the competitor does. */
  features: ReadonlyArray<{ feature: string; sollos: string; them: string; gap?: boolean }>;
  switching: { steps: readonly string[]; after: string };
  faqs: ReadonlyArray<{ q: string; a: string }>;
  disclaimer: string;
};

export const COMPARE_PAGES = [
  {
    slug: "jobber-alternative",
    competitor: "Jobber",
    metaTitle: "Jobber Alternative for Cleaning Companies",
    metaDescription:
      "Sollos is the Jobber alternative built only for cleaning companies. Reminders, checklists and payroll on every plan from $59/mo. Try it free for 14 days.",
    navLabel: "Jobber alternative",
    kicker: "Sollos 3 vs Jobber",
    h1: "The Jobber alternative built for cleaning companies",
    intro:
      "Jobber is built for every trade: landscapers, plumbers, HVAC, pest control. Sollos 3 is built only for cleaning companies. Recurring cleans, crews, room-by-room checklists, payroll and automatic client reminders come with every plan, starting at $59 a month. You pay by the number of cleaners, not users, and there's no contract.",
    checkedOn: "November 28, 2026",
    source: { label: "getjobber.com/pricing", href: "https://getjobber.com/pricing/" },
    price: {
      heading: "What it costs, side by side",
      intro:
        "Regular month-to-month prices in USD, with no annual commitment. On Jobber, automatic client reminders, checklists and time tracking start on the Connect plan, and two-way texting starts on Grow, so those are the plans compared here.",
      columns: ["Your team", "Sollos 3", "Jobber Connect", "Jobber Grow"],
      rows: [
        { team: "Up to 3 cleaners", cells: ["$59/mo", "$199/mo (5-user plan)", "$299/mo (5-user plan)"] },
        { team: "Up to 10 cleaners", cells: ["$119/mo", "$299/mo (10-user plan)", "$399/mo (10-user plan)"] },
        { team: "Up to 25 cleaners", cells: ["$189/mo", "$689/mo*", "$789/mo*"] },
      ],
      notes: [
        "*Jobber's 15-user plan plus 10 extra users at $29/mo each.",
        "Jobber counts every user, office staff included, so a team with an office manager can need the next size up. Sollos counts cleaners only: owners, admins, managers and your on-call bench are free.",
        "To be fair to Jobber, committing lowers its price: Connect for 5 users is $169/mo on a one-year commitment, or $149/mo paid a year up front. Jobber also runs introductory discounts for new customers from time to time. Sollos is month to month; ask us for annual pricing and you pay for 10 months and get 12.",
      ],
    },
    whySwitch: [
      {
        heading: "You're paying for other trades",
        body: "Jobber is built to cover every home service, from plumbing to lawn care. A cleaning company needs recurring visits that run themselves, crews with their own arrival times, and the right checklist on every visit to every home.",
      },
      {
        heading: "The basics sit on higher tiers",
        body: "On Jobber, automatic client reminders and checklists start on Connect, and two-way texting starts on Grow. On Sollos, reminders, checklists, before-and-after photos, clock-in and payroll come with every plan.",
      },
      {
        heading: "The bill grows every time you hire",
        body: "Jobber charges by the user, and each user beyond your plan adds $29 a month. Sollos plans cover up to 3, 10 or 25 cleaners at a flat price, and office staff never count.",
      },
    ],
    everyPlan: [
      "Recurring cleans that schedule themselves. Skip a week or change one visit without breaking the series",
      "A dispatch board with a row per cleaner, drag-to-reschedule, and unassigned visits called out",
      "Crews, not just cleaners: several people on one job, each with their own arrival time, or the hours divided evenly",
      "Room-by-room checklists with required items, plus before-and-after photos from the cleaner's phone",
      "Clock-in and clock-out with location recorded, feeding timesheets at each person's own rate",
      "Payroll on your schedule (weekly, every two weeks, twice a month or monthly), with subcontractor statements kept separate",
      "Offer shift: text an open shift to your subcontractors and on-call bench, and the first to tap the link gets it",
      "Invoices drafted from each visit, sent on the rhythm you choose, and paid by card through Stripe or Square",
      "Booking confirmations, a reminder the day before and review requests, by email or text",
      "A client portal where clients see their visits, request bookings, and view and pay invoices",
      "Team chat and Google Calendar sync",
      "Billing in CAD or USD with your own tax label and rate (GST, HST or sales tax)",
    ],
    betterIf: {
      intro:
        "We'd rather you pick the right tool than switch twice. Jobber is likely the better fit if:",
      points: [
        "You run more than one trade, for example cleaning plus landscaping or handyman work.",
        "You need two-way texting with clients, or “on my way” texts. Sollos doesn't have these yet: client replies to its texts land in a Text replies inbox and your email, and you answer from your own phone.",
        "You need route optimization. Sollos opens each address in Maps but doesn't plan routes.",
        "You need QuickBooks Online or Xero sync today. Sollos syncs with Sage Accounting now; QuickBooks Online is coming.",
        "You want an app from the App Store or Google Play. Sollos runs in the phone's browser and adds to the home screen.",
      ],
      outro:
        "If none of those is a dealbreaker, Sollos will likely cost you less and fit the way a cleaning company works.",
    },
    features: [
      { feature: "Recurring visits", sollos: "Every plan", them: "Yes" },
      { feature: "Automatic client reminders", sollos: "Every plan", them: "Connect and up" },
      { feature: "Checklists", sollos: "Every plan, room by room", them: "Connect and up" },
      { feature: "Before-and-after photos", sollos: "Every plan", them: "Yes; unlimited storage on Plus" },
      { feature: "Clock-in and timesheets", sollos: "Every plan, location recorded", them: "Connect and up; automatic on Grow" },
      { feature: "Payroll", sollos: "Every plan: employee payroll and subcontractor statements", them: "Not built in; timesheets sync to Gusto" },
      { feature: "Text open shifts to subcontractors", sollos: "Every plan", them: "Not listed" },
      { feature: "Review requests", sollos: "Every plan", them: "Reviews add-on" },
      { feature: "Quotes and estimates", sollos: "Yes", them: "Yes" },
      { feature: "Invoicing and card payments", sollos: "Yes, through Stripe or Square", them: "Yes" },
      { feature: "Client portal", sollos: "Yes", them: "Yes (client hub)" },
      { feature: "Accounting sync", sollos: "Sage Accounting; QuickBooks Online coming", them: "QuickBooks Online (Connect and up) and Xero", gap: true },
      { feature: "Two-way client texting", sollos: "Not yet", them: "Grow and up", gap: true },
      { feature: "“On my way” texts", sollos: "Not yet", them: "Yes", gap: true },
      { feature: "Route optimization", sollos: "No (opens each address in Maps)", them: "Yes", gap: true },
      { feature: "Mobile app", sollos: "Runs in the browser, adds to the home screen", them: "iOS and Android apps", gap: true },
      { feature: "Pricing model", sollos: "Flat price by number of cleaners; office staff free", them: "Per user, office staff included; $29/mo per extra user" },
      { feature: "Contract", sollos: "Month to month", them: "Month to month, or a 1-year commitment for a lower price" },
    ],
    switching: {
      steps: [
        "Export your clients from Jobber as a CSV.",
        "Start your Sollos trial. It takes a minute and needs no card.",
        "Import the CSV from the Clients page on any plan, or email it to support@sollos3.com and we'll import it for you during your trial, at no charge.",
        "Set up your recurring visits and add your cleaners.",
        "Run both side by side for a week, then cancel Jobber once your schedule is set.",
      ],
      after: "Your data stays yours: download a full backup from Settings → Your data, anytime.",
    },
    faqs: [
      {
        q: "Is Sollos cheaper than Jobber?",
        a: "For most cleaning teams, yes. A team of up to 10 cleaners pays $119 a month on Sollos. On Jobber, reminders and checklists start on Connect, which is $299 a month for 10 users, month to month. Jobber's one-year and prepaid prices narrow the gap, but lock you in for a year.",
      },
      {
        q: "Can I move my clients from Jobber to Sollos?",
        a: "Yes, on every plan. Export your client list from Jobber as a CSV and import it from the Clients page, or email it to support@sollos3.com and we'll import it for you during your trial, at no charge.",
      },
      {
        q: "Does Sollos have two-way texting like Jobber?",
        a: "Not yet. Sollos sends booking confirmations, reminders, review requests and open-shift texts, and when a client replies, the message lands in your Text replies inbox and your email so you can answer from your phone. Your team also has in-app chat. On Jobber, two-way texting starts on the Grow plan.",
      },
      {
        q: "Does Sollos sync with QuickBooks?",
        a: "Not yet. Sollos syncs invoices and payments with Sage Accounting today, and QuickBooks Online sync is coming. Jobber syncs with QuickBooks Online on Connect and up, and with Xero.",
      },
      {
        q: "Do I need a contract?",
        a: "No. Every Sollos plan is month to month, and you can cancel anytime from your account settings.",
      },
      {
        q: "Who counts as a cleaner?",
        a: "Employees and subcontractors active on your crew. Owners, admins, managers and your on-call bench don't count toward your plan.",
      },
      {
        q: "Does Sollos work for commercial and janitorial cleaning?",
        a: "Yes. Sollos handles recurring site schedules, crews, site checklists and monthly billing for commercial and janitorial teams, alongside residential clients if you do both.",
      },
      {
        q: "Is there a free trial?",
        a: "Yes, 14 days with no credit card. You'll get a reminder before it ends.",
      },
    ],
    disclaimer:
      "Jobber is a trademark of its owner. Sollos isn't affiliated with or endorsed by Jobber. Comparisons are based on information Jobber publishes on its pricing page, as of the date above.",
  },
] as const satisfies ReadonlyArray<ComparePageContent>;

export type CompareSlug = (typeof COMPARE_PAGES)[number]["slug"];

export function getComparePage(slug: CompareSlug): ComparePageContent {
  // The slug type only admits real pages, so this always finds one.
  return COMPARE_PAGES.find((p) => p.slug === slug)!;
}
