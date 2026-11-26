/**
 * Searching invoices past the newest 500 the list loads.
 *
 * The Invoices page loads the newest 500 invoices and its search box looks
 * through those. Svit had 350 on 2026-11-25 and adds 55 to 60 a month, so
 * from about February their oldest invoices would have been out of reach:
 * typing a client's name would find only their recent ones. When the list
 * is that full, a search also asks the database, across every invoice, for
 * the ones whose client name or invoice number contains a word typed; the
 * table adds those to what it shows and its own search narrows the lot
 * (lib/../app/app/invoices/search-actions.ts).
 *
 * Only names and numbers go to the database. Dates, amounts and statuses
 * are matched by the table as before, in the company's time zone and the
 * spellings it shows. Pure, so the filter is tested without a database.
 */
import { textTerm } from "@/lib/booking-search";

/** How many older matches one search brings in. */
export const OLDER_MATCH_LIMIT = 200;

/**
 * The words worth sending: two letters or more, at most five. A single
 * letter or digit would match nearly every invoice and tell nobody anything.
 */
export function searchTokens(needle: string): string[] {
  const words = textTerm(needle)
    .toLowerCase()
    .split(" ")
    .filter((w) => w.length >= 2);
  return [...new Set(words)].slice(0, 5);
}

/** Something that never matches an invoice: an or() needs at least one term. */
const NOTHING = "id.eq.00000000-0000-0000-0000-000000000000";

/**
 * The search as a PostgREST or() filter on invoices: any client found by
 * name, or a number containing one of the words.
 */
export function invoiceSearchOr(args: { tokens: string[]; clientIds: string[] }): string {
  const terms: string[] = [];
  if (args.clientIds.length > 0) terms.push(`client_id.in.(${args.clientIds.join(",")})`);
  for (const t of args.tokens) terms.push(`number.ilike.*${t}*`);
  return terms.length > 0 ? terms.join(",") : NOTHING;
}

/** The loaded rows, then any found further back that aren't among them. */
export function withOlder<T extends { id: string }>(loaded: T[], older: T[]): T[] {
  if (older.length === 0) return loaded;
  const have = new Set(loaded.map((r) => r.id));
  const extra = older.filter((r) => !have.has(r.id));
  return extra.length === 0 ? loaded : [...loaded, ...extra];
}
