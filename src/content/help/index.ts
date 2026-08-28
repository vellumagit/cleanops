import { body as gettingAround } from "./getting-around";
import { body as leadsAndClients } from "./leads-and-clients";
import { body as bookings } from "./bookings";
import { body as checklists } from "./checklists";
import { body as invoicing } from "./invoicing";
import { body as timesheetsAndPayroll } from "./timesheets-and-payroll";
import { body as websiteForms } from "./website-forms";
import { body as clientPortal } from "./client-portal";
import { body as automations } from "./automations";
import { body as hiring } from "./hiring";

/**
 * The in-app Help library. Plain typed modules, on purpose:
 *
 * - No database, no editor, no CMS. Articles are code, reviewed like code.
 * - They deploy WITH the feature they describe, so a doc can never describe
 *   a version of the app that isn't the one running. The working rule that
 *   keeps this true: a change to how something works and the edit to its
 *   help page travel in the same commit.
 *
 * Owner-authored content (how THIS org cleans a kitchen) does not belong
 * here — that's Training. Micro-tricks belong in Settings → Tips.
 */

export type HelpArticle = {
  slug: string;
  title: string;
  blurb: string;
  section: string;
  body: string;
};

export const HELP_SECTIONS = [
  "Start here",
  "Day to day",
  "Money",
  "Website & portal",
] as const;

export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: "getting-around",
    title: "Getting around Sollos",
    blurb: "The three surfaces, the sidebar, badges, and where to find the fast paths.",
    section: "Start here",
    body: gettingAround,
  },
  {
    slug: "bookings",
    title: "Bookings",
    blurb: "Creating and pricing visits, recurring schedules, split shifts, skips and deletes.",
    section: "Day to day",
    body: bookings,
  },
  {
    slug: "checklists",
    title: "Checklists",
    blurb: "Attach by service, by client, or by hand — and what happens when you revoke one.",
    section: "Day to day",
    body: checklists,
  },
  {
    slug: "leads-and-clients",
    title: "Leads & clients",
    blurb: "The lifecycle from inquiry to client, and everything that converts automatically.",
    section: "Day to day",
    body: leadsAndClients,
  },
  {
    slug: "automations",
    title: "Automations",
    blurb: "The fixed set of switches, who actually receives what, and the cadence knobs.",
    section: "Day to day",
    body: automations,
  },
  {
    slug: "hiring",
    title: "Hiring",
    blurb: "Applicants, interview questionnaires, hiring procedures — and where training takes over.",
    section: "Day to day",
    body: hiring,
  },
  {
    slug: "invoicing",
    title: "Invoicing",
    blurb: "Per-visit invoices, batch billing, the draft→sent→paid lifecycle, finding things fast.",
    section: "Money",
    body: invoicing,
  },
  {
    slug: "timesheets-and-payroll",
    title: "Timesheets & payroll",
    blurb: "Hours to paid: rates, review, payroll runs, contractor statements, and the CSV warning.",
    section: "Money",
    body: timesheetsAndPayroll,
  },
  {
    slug: "website-forms",
    title: "Website forms",
    blurb: "Estimate and contact forms posting straight into leads, requests, and your inbox.",
    section: "Website & portal",
    body: websiteForms,
  },
  {
    slug: "client-portal",
    title: "The client portal",
    blurb: "What clients can do themselves — and how phoned-in requests use the same rails.",
    section: "Website & portal",
    body: clientPortal,
  },
];

export function getHelpArticle(slug: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((a) => a.slug === slug);
}
