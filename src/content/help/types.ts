/**
 * The shape of one Help guide. Lives apart from index.ts so each article
 * module can import it without importing the whole library.
 */

export const HELP_SECTIONS = [
  "Start here",
  "Scheduling & jobs",
  "Clients & sales",
  "Your team",
  "The field app",
  "Money",
  "Website & portal",
  "Settings & connections",
] as const;

export type HelpSection = (typeof HELP_SECTIONS)[number];

export type HelpArticle = {
  /** URL slug: /app/help/<slug> and /help/<slug>. */
  slug: string;
  title: string;
  /** One line under the title in lists and search results. */
  blurb: string;
  section: HelpSection;
  /**
   * The app pages this guide is THE guide for, as route patterns exactly as
   * they sit under src/app (dynamic parts in brackets: /app/bookings/[id]).
   * Drives "Help for this page" and tells the assistant which guide covers
   * the page a user is on. A test checks every one is a real page.
   */
  paths: string[];
  /**
   * Words people search with that the article itself may not use:
   * "bill" for invoices, "cleaner" for employees, "quote" for estimates.
   * Feeds search only; never shown.
   */
  keywords: string[];
  /** Markdown (the small grammar in lib/simple-markdown). */
  body: string;
};
