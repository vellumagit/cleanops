import { HELP_SECTIONS, type HelpArticle } from "./types";
import { createHelpSearch } from "./search";
import { routePatternToRegExp } from "./site-map";

// Start here
import { article as gettingAround } from "./getting-around";
import { article as firstSteps } from "./first-steps";
import { article as dashboard } from "./dashboard";
import { article as rolesAndPermissions } from "./roles-and-permissions";
import { article as notifications } from "./notifications";
import { article as assistant } from "./assistant";
import { article as feedback } from "./feedback";
// Scheduling & jobs
import { article as bookings } from "./bookings";
import { article as recurringSeries } from "./recurring-series";
import { article as schedulingBoard } from "./scheduling-board";
import { article as requests } from "./requests";
import { article as shiftOffers } from "./shift-offers";
import { article as checklists } from "./checklists";
import { article as tasks } from "./tasks";
import { article as inventory } from "./inventory";
// Clients & sales
import { article as leadsAndClients } from "./leads-and-clients";
import { article as clients } from "./clients";
import { article as estimates } from "./estimates";
import { article as contracts } from "./contracts";
import { article as packages } from "./packages";
import { article as network } from "./network";
import { article as reviews } from "./reviews";
// Your team
import { article as employees } from "./employees";
import { article as onCallPool } from "./on-call-pool";
import { article as hiring } from "./hiring";
import { article as training } from "./training";
import { article as bonuses } from "./bonuses";
import { article as teamComms } from "./team-comms";
// The field app
import { article as fieldApp } from "./field-app";
import { article as fieldTimeAndPay } from "./field-time-and-pay";
import { article as availabilityAndTimeOff } from "./availability-and-time-off";
// Money
import { article as invoicing } from "./invoicing";
import { article as billingCycles } from "./billing-cycles";
import { article as gettingPaid } from "./getting-paid";
import { article as timesheetsAndPayroll } from "./timesheets-and-payroll";
import { article as contractorPay } from "./contractor-pay";
import { article as reports } from "./reports";
// Website & portal
import { article as websiteForms } from "./website-forms";
import { article as clientPortal } from "./client-portal";
// Settings & connections
import { article as companySettings } from "./company-settings";
import { article as texting } from "./texting";
import { article as automations } from "./automations";
import { article as integrations } from "./integrations";
import { article as apiAndWebhooks } from "./api-and-webhooks";
import { article as accountAndSecurity } from "./account-and-security";

/**
 * The Sollos manual. Plain typed modules, on purpose:
 *
 * - No database, no editor, no CMS. Articles are code, reviewed like code.
 * - They deploy WITH the feature they describe, so a doc can never describe
 *   a version of the app that isn't the one running. The working rule that
 *   keeps this true: a change to how something works and the edit to its
 *   help page travel in the same commit.
 * - The same text feeds three readers: /app/help (signed in), /help (public,
 *   for search engines and the curious), and the assistant's prompt.
 * - help-content.test.ts holds every article to the pages that exist: paths
 *   claimed, links written, guides cross-referenced.
 *
 * Owner-authored content (how THIS org cleans a kitchen) does not belong
 * here — that's Training. Micro-tricks belong in Settings → Tips.
 *
 * Order matters: within a section, articles render in the order listed.
 */

export { HELP_SECTIONS };
export type { HelpArticle };

export const HELP_ARTICLES: HelpArticle[] = [
  gettingAround,
  firstSteps,
  dashboard,
  rolesAndPermissions,
  notifications,
  assistant,
  feedback,

  bookings,
  recurringSeries,
  schedulingBoard,
  requests,
  shiftOffers,
  checklists,
  tasks,
  inventory,

  leadsAndClients,
  clients,
  estimates,
  contracts,
  packages,
  network,
  reviews,

  employees,
  onCallPool,
  hiring,
  training,
  bonuses,
  teamComms,

  fieldApp,
  fieldTimeAndPay,
  availabilityAndTimeOff,

  invoicing,
  billingCycles,
  gettingPaid,
  timesheetsAndPayroll,
  contractorPay,
  reports,

  websiteForms,
  clientPortal,

  companySettings,
  texting,
  automations,
  integrations,
  apiAndWebhooks,
  accountAndSecurity,
].sort(
  (a, b) => HELP_SECTIONS.indexOf(a.section) - HELP_SECTIONS.indexOf(b.section),
);

export function getHelpArticle(slug: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((a) => a.slug === slug);
}

/** Just enough of each guide for the browser — the assistant panel uses it to
 *  check the links it shows and to offer the guide for the current page,
 *  without shipping the manual's text to every page load. */
export type HelpGuideRef = Pick<HelpArticle, "slug" | "title" | "paths">;
export const HELP_GUIDE_INDEX: HelpGuideRef[] = HELP_ARTICLES.map(
  ({ slug, title, paths }) => ({ slug, title, paths }),
);

/** Search across every guide, section by section (see ./search). */
export const searchHelp = createHelpSearch(HELP_ARTICLES);

/** The guide that is THE guide for the page at this URL, if one claims it.
 *  An exact static claim beats a dynamic one, so /app/bookings/series finds
 *  Recurring series rather than a booking. */
export function helpForUrl(url: string): HelpArticle | undefined {
  const clean = url.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  let dynamicHit: HelpArticle | undefined;
  for (const a of HELP_ARTICLES) {
    for (const p of a.paths) {
      if (!routePatternToRegExp(p).test(clean)) continue;
      if (!p.includes("[")) return a;
      dynamicHit ??= a;
    }
  }
  return dynamicHit;
}
