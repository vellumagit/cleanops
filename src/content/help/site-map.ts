/**
 * Every page a user can actually open, with the name they know it by and how
 * to get there. Two readers:
 *
 * - The assistant. Asked "where do I change X?", a model with no list of real
 *   pages makes one up — it told a user about a path that didn't exist. With
 *   this list in its prompt and an instruction to name only what's here, it
 *   can point at real places.
 * - The help tests. `help-content.test.ts` checks this list against the
 *   page.tsx files on disk in both directions, so a new page that isn't
 *   listed, or a listed page that was deleted, fails CI rather than turning
 *   into a wrong answer.
 *
 * `path` is the route pattern as the folder is named (dynamic parts in
 * brackets; route groups like "(portal)" kept, since that's the folder). The
 * URL a user sees drops the group: /client/(portal)/jobs is /client/jobs.
 */

export type SiteArea = "office" | "field" | "client" | "public";

export type SitePage = {
  path: string;
  /** What the page is called on screen. */
  name: string;
  /** How a person gets there, in the words of the menus. */
  where: string;
  area: SiteArea;
  /** Office roles that can open it, when narrower than everyone. */
  roles?: string;
};

const OWNER_ADMIN = "owners and admins";
const OFFICE = "owners, admins and managers";

export const SITE_MAP: SitePage[] = [
  // ─── Office: overview ──────────────────────────────────────────────
  { path: "/app", name: "Dashboard", where: "Sidebar → Dashboard (Today tab on a phone)", area: "office" },
  { path: "/app/setup", name: "Setup checklist", where: "The Get started banner at the top of the sidebar, shown while a new workspace is being set up", area: "office", roles: OWNER_ADMIN },

  // ─── Office: operations ────────────────────────────────────────────
  { path: "/app/bookings", name: "Bookings", where: "Sidebar → Operations → Bookings", area: "office" },
  { path: "/app/bookings/new", name: "New booking", where: "Bookings → New booking, or the + button", area: "office" },
  { path: "/app/bookings/[id]", name: "A booking's page", where: "Click the job on the scheduler or calendar, on a client's profile, on an invoice, or on the dashboard (rows on the Bookings list open the edit form instead)", area: "office" },
  { path: "/app/bookings/[id]/edit", name: "Edit booking", where: "Bookings → click a row, or a booking's page → Edit", area: "office" },
  { path: "/app/bookings/[id]/offer", name: "Offer a shift", where: "A booking → Offer shift (also on the bookings list and the scheduler quick view)", area: "office", roles: OFFICE },
  { path: "/app/bookings/requests", name: "Requests", where: "Sidebar → Operations → Requests", area: "office", roles: OFFICE },
  { path: "/app/bookings/series", name: "Recurring series", where: "Bookings → Recurring (the button shows a count)", area: "office" },
  { path: "/app/calendar", name: "Calendar", where: "Sidebar → Operations → Calendar", area: "office" },
  { path: "/app/scheduling", name: "Scheduling", where: "Sidebar → Operations → Scheduling (Schedule tab on a phone)", area: "office", roles: OFFICE },
  { path: "/app/estimates", name: "Estimates", where: "Sidebar → Operations → Estimates", area: "office", roles: OFFICE },
  { path: "/app/estimates/new", name: "New estimate", where: "Estimates → New estimate", area: "office", roles: OFFICE },
  { path: "/app/estimates/[id]/edit", name: "Edit estimate", where: "Estimates → click an estimate", area: "office", roles: OFFICE },
  { path: "/app/contracts", name: "Contracts", where: "Sidebar → Operations → Contracts", area: "office", roles: OFFICE },
  { path: "/app/contracts/new", name: "New contract", where: "Contracts → New contract", area: "office", roles: OFFICE },
  { path: "/app/contracts/[id]/edit", name: "Edit contract", where: "Contracts → click a contract", area: "office", roles: OFFICE },
  { path: "/app/checklists", name: "Checklists", where: "Sidebar → Operations → Checklists", area: "office", roles: OFFICE },
  { path: "/app/checklists/new", name: "New checklist template", where: "Checklists → New template", area: "office", roles: OFFICE },
  { path: "/app/checklists/[id]", name: "A checklist", where: "Checklists → click a checklist", area: "office", roles: OFFICE },
  { path: "/app/tasks", name: "Tasks", where: "Sidebar → Operations → Tasks", area: "office" },
  { path: "/app/tasks/new", name: "New task", where: "Tasks → New task", area: "office" },
  { path: "/app/tasks/[id]/edit", name: "Edit task", where: "Tasks → click a task", area: "office" },
  { path: "/app/inventory", name: "Inventory", where: "Sidebar → Operations → Inventory", area: "office" },
  { path: "/app/inventory/new", name: "New inventory item", where: "Inventory → New item", area: "office" },
  { path: "/app/inventory/[id]/edit", name: "Edit inventory item", where: "Inventory → click an item", area: "office" },
  { path: "/app/packages", name: "Packages", where: "Not linked from any menu; open it by its address", area: "office", roles: OFFICE },
  { path: "/app/packages/new", name: "New package", where: "Packages → New", area: "office", roles: OFFICE },
  { path: "/app/packages/[id]/edit", name: "Edit package", where: "Packages → click a package", area: "office", roles: OFFICE },

  // ─── Office: people ────────────────────────────────────────────────
  { path: "/app/leads", name: "Leads", where: "Sidebar → People → Leads", area: "office", roles: OFFICE },
  { path: "/app/clients", name: "Clients", where: "Sidebar → People → Clients", area: "office", roles: OFFICE },
  { path: "/app/clients/new", name: "New client", where: "Clients → New client", area: "office", roles: OFFICE },
  { path: "/app/clients/import", name: "Import clients", where: "Clients → Import CSV", area: "office", roles: OFFICE },
  { path: "/app/clients/[id]", name: "A client's profile", where: "Clients → click a client", area: "office", roles: OFFICE },
  { path: "/app/clients/[id]/edit", name: "Edit client", where: "A client's profile → Edit", area: "office", roles: OFFICE },
  { path: "/app/clients/[id]/statement", name: "Client statement", where: "A client's profile → Statement", area: "office", roles: OFFICE },
  { path: "/app/employees", name: "Employees", where: "Sidebar → People → Employees", area: "office", roles: OWNER_ADMIN },
  { path: "/app/employees/[id]", name: "An employee's profile", where: "Employees → click a person", area: "office", roles: OWNER_ADMIN },
  { path: "/app/employees/[id]/edit", name: "Edit employee", where: "An employee's profile → Edit", area: "office", roles: OWNER_ADMIN },
  { path: "/app/freelancers", name: "On-call pool", where: "Sidebar → People → On-call pool", area: "office", roles: OFFICE },
  { path: "/app/freelancers/new", name: "Add to on-call pool", where: "On-call pool → New contact", area: "office", roles: OFFICE },
  { path: "/app/freelancers/[id]/edit", name: "Edit on-call contact", where: "On-call pool → click a person", area: "office", roles: OFFICE },
  { path: "/app/freelancers/offers", name: "Shift offers", where: "On-call pool → Offers", area: "office", roles: OFFICE },
  { path: "/app/freelancers/offers/[id]", name: "A shift offer", where: "On-call pool → Offers → click an offer", area: "office", roles: OFFICE },
  { path: "/app/freelancers/payables", name: "Subcontractor payables", where: "Old address; it now opens Payroll → Contractors", area: "office", roles: OFFICE },
  { path: "/app/freelancers/payables/[contactId]", name: "One subcontractor's payables", where: "Old address; use Payroll → Contractors → click a person", area: "office", roles: OFFICE },
  { path: "/app/network", name: "Network", where: "Sidebar → People → Network", area: "office", roles: OFFICE },
  { path: "/app/network/new", name: "New network contact", where: "Network → Add contact", area: "office", roles: OFFICE },
  { path: "/app/network/[id]/edit", name: "Edit network contact", where: "Network → click a contact", area: "office", roles: OFFICE },
  { path: "/app/reviews", name: "Reviews", where: "Sidebar → People → Reviews", area: "office" },
  { path: "/app/reviews/new", name: "New review", where: "Reviews → New review", area: "office" },
  { path: "/app/bonuses", name: "Bonuses", where: "Sidebar → People → Bonuses", area: "office", roles: OWNER_ADMIN },

  // ─── Office: hiring ────────────────────────────────────────────────
  { path: "/app/applicants", name: "Applicants", where: "Sidebar → Hiring → Applicants", area: "office", roles: OWNER_ADMIN },
  { path: "/app/applicants/[id]", name: "An applicant", where: "Applicants → click an applicant", area: "office", roles: OWNER_ADMIN },
  { path: "/app/hiring", name: "Hiring library", where: "Sidebar → Hiring → Hiring", area: "office", roles: OWNER_ADMIN },
  { path: "/app/training", name: "Training", where: "Sidebar → Hiring → Training", area: "office" },
  { path: "/app/training/new", name: "New training module", where: "Training → New module", area: "office" },
  { path: "/app/training/[id]", name: "A training module", where: "Training → click a module", area: "office" },
  { path: "/app/training/[id]/edit", name: "Edit training module", where: "A training module → Edit", area: "office" },

  // ─── Office: money ─────────────────────────────────────────────────
  { path: "/app/invoices", name: "Invoices", where: "Sidebar → Money → Invoices", area: "office", roles: OFFICE },
  { path: "/app/invoices/new", name: "New invoice", where: "Invoices → New invoice", area: "office", roles: OFFICE },
  { path: "/app/invoices/period", name: "Batch billing", where: "Invoices → Bill for a period", area: "office", roles: OFFICE },
  { path: "/app/invoices/[id]", name: "An invoice", where: "Invoices → click an invoice", area: "office", roles: OFFICE },
  { path: "/app/invoices/[id]/edit", name: "Edit invoice", where: "An invoice → Edit", area: "office", roles: OFFICE },
  { path: "/app/timesheets", name: "Timesheets", where: "Sidebar → Money → Timesheets", area: "office", roles: OFFICE },
  { path: "/app/payroll", name: "Payroll", where: "Sidebar → Money → Payroll", area: "office", roles: OWNER_ADMIN },
  { path: "/app/payroll/[id]", name: "A payroll run", where: "Payroll → click a run", area: "office", roles: OWNER_ADMIN },
  { path: "/app/payroll/periods/[range]", name: "A pay period", where: "Payroll → click a period", area: "office", roles: OWNER_ADMIN },
  { path: "/app/payroll/contractors", name: "Contractor pay", where: "Payroll → Contractors", area: "office", roles: OWNER_ADMIN },
  { path: "/app/payroll/contractors/[contactId]", name: "One contractor's pay", where: "Payroll → Contractors → click a person", area: "office", roles: OWNER_ADMIN },
  { path: "/app/payroll/invoices", name: "Contractor invoices", where: "Payroll → All pay invoices", area: "office", roles: OWNER_ADMIN },
  { path: "/app/reports", name: "Reports", where: "Sidebar → Money → Reports", area: "office", roles: OWNER_ADMIN },

  // ─── Office: comms ─────────────────────────────────────────────────
  { path: "/app/announce", name: "Announce", where: "Sidebar → Comms → Announce", area: "office", roles: OFFICE },
  { path: "/app/texts", name: "Text replies", where: "Sidebar → Comms → Text replies", area: "office", roles: OFFICE },
  { path: "/app/feed", name: "Feed", where: "Sidebar → Comms → Feed (when the feed is turned on)", area: "office" },
  { path: "/app/chat", name: "Chat", where: "Sidebar → Comms → Chat", area: "office" },

  // ─── Office: footer ────────────────────────────────────────────────
  { path: "/app/help", name: "Help", where: "Sidebar → Help (bottom)", area: "office", roles: OFFICE },
  { path: "/app/help/[slug]", name: "A help guide", where: "Help → click a guide", area: "office", roles: OFFICE },
  { path: "/app/feedback", name: "Feedback", where: "Sidebar → Feedback (bottom)", area: "office" },
  { path: "/app/feedback/new", name: "Report a problem", where: "Feedback → Report something, or Report a problem in the assistant", area: "office" },
  { path: "/app/feedback/[id]", name: "A feedback thread", where: "Feedback → click a report", area: "office" },
  { path: "/app/notifications", name: "Notifications", where: "Sidebar → Notifications (bottom)", area: "office" },
  { path: "/app/notifications/choices", name: "What alerts you", where: "Notifications → choose what alerts you, or Settings → You → What alerts you", area: "office" },
  { path: "/app/profile", name: "Your profile", where: "Settings → You → Your profile", area: "office" },
  { path: "/app/profile/security", name: "Sign-in security", where: "Settings → You → Security", area: "office" },

  // ─── Office: settings ──────────────────────────────────────────────
  // Groups regrouped 2026-11-21: Your company, Clients, Money, Team,
  // Connections, Account, You. Keep these in step with app/app/settings/page.tsx.
  { path: "/app/settings", name: "Settings", where: "Sidebar → Settings (bottom)", area: "office", roles: OWNER_ADMIN },
  { path: "/app/settings/email", name: "Email & contact info", where: "Settings → Your company → Email & contact info", area: "office", roles: OWNER_ADMIN },
  { path: "/app/settings/branding", name: "Branding", where: "Settings → Your company → Branding", area: "office", roles: OWNER_ADMIN },
  { path: "/app/settings/services", name: "Services", where: "Settings → Your company → Services", area: "office", roles: OWNER_ADMIN },
  { path: "/app/settings/timezone", name: "Timezone", where: "Settings → Your company → Timezone", area: "office", roles: OWNER_ADMIN },
  { path: "/app/settings/currency", name: "Currency, tax & holidays", where: "Settings → Your company → Currency, tax & holidays", area: "office", roles: OWNER_ADMIN },
  { path: "/app/settings/automations", name: "Client messages (client automations, presets, the automations master switch)", where: "Settings → Clients → Client messages", area: "office", roles: OWNER_ADMIN },
  { path: "/app/settings/sms", name: "SMS / Texting", where: "Settings → Clients → SMS / Texting", area: "office", roles: OWNER_ADMIN },
  { path: "/app/settings/intake-forms", name: "Website & lead forms (intake forms, new-lead alerts)", where: "Settings → Clients → Website & lead forms", area: "office", roles: OWNER_ADMIN },
  { path: "/app/settings/invoicing", name: "Invoicing settings (auto-send, auto-draft, morning digest, auto-void and its days)", where: "Settings → Money → Invoicing", area: "office", roles: OWNER_ADMIN },
  { path: "/app/settings/recurring-invoices", name: "Recurring invoices", where: "Settings → Money → Recurring invoices", area: "office", roles: OWNER_ADMIN },
  { path: "/app/settings/recurring-invoices/new", name: "New recurring invoice", where: "Recurring invoices → New series", area: "office", roles: OWNER_ADMIN },
  { path: "/app/settings/recurring-invoices/[id]", name: "A recurring invoice", where: "Recurring invoices → click one", area: "office", roles: OWNER_ADMIN },
  { path: "/app/settings/payment-methods", name: "Getting paid (card payments, payment instructions, tips)", where: "Settings → Money → Getting paid", area: "office", roles: OWNER_ADMIN },
  { path: "/app/settings/members", name: "Team members", where: "Settings → Team → Team members", area: "office", roles: OWNER_ADMIN },
  { path: "/app/settings/payroll", name: "Payroll & timesheets settings (pay periods, clock-out reminders, overtime and its hours)", where: "Settings → Team → Payroll & timesheets", area: "office", roles: OWNER_ADMIN },
  { path: "/app/settings/bonus-rules", name: "Bonus rules", where: "Settings → Team → Bonus rules", area: "office", roles: OWNER_ADMIN },
  { path: "/app/settings/team-alerts", name: "Team alerts & housekeeping (crew schedules, office alerts, digests, auto-complete, auto-expire, auto-archive and their timing)", where: "Settings → Team → Team alerts & housekeeping", area: "office", roles: OWNER_ADMIN },
  { path: "/app/settings/thresholds", name: "Automation thresholds (old address)", where: "Old address; opens Team alerts & housekeeping, where each timing setting now sits under its switch", area: "office", roles: OWNER_ADMIN },
  { path: "/app/settings/integrations", name: "Integrations", where: "Settings → Connections → Integrations", area: "office", roles: OWNER_ADMIN },
  { path: "/app/settings/api-keys", name: "API keys", where: "Settings → Connections → API Keys", area: "office", roles: OWNER_ADMIN },
  { path: "/app/settings/webhooks", name: "Webhooks", where: "Settings → Connections → Webhooks", area: "office", roles: OWNER_ADMIN },
  { path: "/app/settings/billing", name: "Billing (your Sollos plan)", where: "Settings → Account → Billing", area: "office", roles: OWNER_ADMIN },
  { path: "/app/settings/audit-log", name: "Audit log", where: "Settings → Account → Audit log", area: "office", roles: OWNER_ADMIN },
  { path: "/app/settings/data", name: "Your data", where: "Settings → Account → Your data", area: "office", roles: OWNER_ADMIN },
  { path: "/app/settings/tips", name: "Tips & shortcuts", where: "Settings → You → Tips & shortcuts", area: "office", roles: OWNER_ADMIN },

  // ─── Field app (cleaners) ──────────────────────────────────────────
  { path: "/field", name: "Field app home", where: "Opening Sollos as a cleaner", area: "field" },
  { path: "/field/jobs", name: "Today (jobs)", where: "Field app → Today tab", area: "field" },
  { path: "/field/jobs/[id]", name: "A job (field)", where: "Field app → Today → tap a job", area: "field" },
  { path: "/field/shifts", name: "Shifts", where: "Field app → Shifts tab", area: "field" },
  { path: "/field/clock", name: "Clock", where: "Field app → Clock tab", area: "field" },
  { path: "/field/feed", name: "Feed (field)", where: "Field app → Feed tab", area: "field" },
  { path: "/field/chat", name: "Chat (field)", where: "Field app → Chat tab", area: "field" },
  { path: "/field/profile", name: "Profile (field)", where: "Field app → Profile tab", area: "field" },
  { path: "/field/profile/security", name: "Sign-in security (field)", where: "Field app → Profile → Security", area: "field" },
  { path: "/field/availability", name: "Availability", where: "Field app → Profile → My availability", area: "field" },
  { path: "/field/time-off", name: "Time off", where: "Field app → Profile → Time off", area: "field" },
  { path: "/field/hours", name: "My hours", where: "Field app → Profile → My hours (or All my hours on the Clock tab)", area: "field" },
  { path: "/field/pay", name: "My pay", where: "Field app → Profile → My pay", area: "field" },
  { path: "/field/tasks", name: "Tasks (field)", where: "Field app → Profile → My tasks (or the tasks note on Today)", area: "field" },
  { path: "/field/training", name: "Training (field)", where: "Field app → Profile → Training modules", area: "field" },
  { path: "/field/training/[moduleId]", name: "A training module (field)", where: "Field app → Training → tap a module", area: "field" },

  // ─── Client portal ─────────────────────────────────────────────────
  { path: "/client/(portal)", name: "Client portal home", where: "A client signing in at /client", area: "client" },
  { path: "/client/(portal)/jobs", name: "Jobs (portal)", where: "Client portal → Jobs tab", area: "client" },
  { path: "/client/(portal)/jobs/[id]", name: "A job (portal)", where: "Client portal → Jobs → tap a job", area: "client" },
  { path: "/client/(portal)/invoices", name: "Invoices (portal)", where: "Client portal → Invoices tab", area: "client" },
  { path: "/client/(portal)/request", name: "Request (portal)", where: "Client portal → Request tab", area: "client" },
  { path: "/client/(public)/login", name: "Client sign-in", where: "/client/login", area: "client" },
  { path: "/client/(public)/reset", name: "Client password reset", where: "Client sign-in → Forgot password", area: "client" },
  { path: "/client/(public)/claim/[token]", name: "Client portal invitation", where: "The link in a client's portal invite email", area: "client" },

  // ─── Links people receive ──────────────────────────────────────────
  { path: "/e/[token]", name: "Estimate (client view)", where: "The link in an estimate email", area: "public" },
  { path: "/c/[token]", name: "Contract to sign", where: "The link in a contract email", area: "public" },
  { path: "/i/[token]", name: "Invoice (client view)", where: "The link in an invoice email or text", area: "public" },
  { path: "/pay/[id]/success", name: "Payment received", where: "After a client pays online", area: "public" },
  { path: "/pay/[id]/cancelled", name: "Payment cancelled", where: "After a client backs out of paying online", area: "public" },
  { path: "/review/[token]", name: "Leave a review", where: "The link in a review request", area: "public" },
  { path: "/claim/[token]", name: "Claim a shift", where: "The link in a shift offer text or email", area: "public" },
  { path: "/join", name: "Join a team", where: "Sollos sign-up for someone invited", area: "public" },
  { path: "/join/[token]", name: "Team invitation", where: "The link in a team invite", area: "public" },
  { path: "/u/g/[token]", name: "Unsubscribe from review requests", where: "The unsubscribe link in a review-request email", area: "public" },
  { path: "/texting/[orgId]/privacy", name: "Texting privacy policy", where: "Linked from texting sign-up", area: "public" },
  { path: "/texting/[orgId]/terms", name: "Texting terms", where: "Linked from texting sign-up", area: "public" },
  { path: "/help", name: "Public help guides", where: "sollos3.com/help", area: "public" },
  { path: "/help/[slug]", name: "A public help guide", where: "sollos3.com/help → a guide", area: "public" },
];

/** Route pattern → a RegExp matching concrete URLs. Route groups vanish
 *  from the URL; [param] matches one segment. */
export function routePatternToRegExp(pattern: string): RegExp {
  const parts = pattern
    .split("/")
    .filter((p) => p !== "" && !/^\(.+\)$/.test(p))
    .map((p) =>
      /^\[.+\]$/.test(p) ? "[^/]+" : p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    );
  return new RegExp(`^/${parts.join("/")}/?$`);
}

/** The URL a static pattern is reachable at (route groups removed), or null
 *  for a pattern with dynamic segments. */
export function staticUrlFor(pattern: string): string | null {
  if (pattern.includes("[")) return null;
  const parts = pattern.split("/").filter((p) => p !== "" && !/^\(.+\)$/.test(p));
  return `/${parts.join("/")}`;
}

/** The site-map entry a concrete URL belongs to, if any. Static entries win
 *  over dynamic ones (/app/bookings/new is "New booking", not a booking). */
export function findSitePage(url: string): SitePage | undefined {
  const clean = url.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  const matches = SITE_MAP.filter((p) => routePatternToRegExp(p.path).test(clean));
  return matches.find((p) => !p.path.includes("[")) ?? matches[0];
}

export function isRealAppUrl(url: string): boolean {
  return findSitePage(url) !== undefined;
}
