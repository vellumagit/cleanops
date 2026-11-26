/**
 * Searching the bookings list on the server.
 *
 * Searching "Brian" on Past or All showed only his upcoming visits
 * (2026-11-25). Three things added up: a search skipped the time tab on
 * purpose (since July), the mixed result put upcoming visits first (since
 * September), and from 2026-11-21 the table drew 50 rows at a time. With 55
 * visits ahead of him, his two past ones sat behind "Show 50 more". The
 * commit that fixed it blamed the list's 1,000-row limit instead; neither
 * company was near it (Svit 989 bookings, Velluma 511), so that was wrong.
 * The tabs now apply to a search, and Past and All ask the database for the
 * matching bookings themselves, across the whole history, so the limit
 * can't hide any either once a company passes it.
 *
 * It matches what the table's own search box matches: the client's name,
 * the service as shown, the address, and the cleaner the job is assigned
 * to. Names live on other tables, so they are looked up first and arrive
 * here as ids. Pure, so the filter is tested without a database.
 */

/** Something that never matches a booking: an or() needs at least one term. */
const NOTHING = "id.eq.00000000-0000-0000-0000-000000000000";

/**
 * The search as a PostgREST or() filter on bookings. Characters that mean
 * something in that syntax (commas and brackets separate terms, * is the
 * wildcard, quotes and backslashes escape) are taken out of the text, so a
 * search for "Smith, J." can't break the request or widen the match.
 */
export function bookingSearchOr(args: { needle: string; clientIds: string[]; memberIds: string[] }): string {
  const text = textTerm(args.needle);
  const terms: string[] = [];
  if (args.clientIds.length > 0) terms.push(`client_id.in.(${args.clientIds.join(",")})`);
  if (args.memberIds.length > 0) terms.push(`assigned_to.in.(${args.memberIds.join(",")})`);
  if (text) {
    terms.push(`service_type_label.ilike.*${text}*`);
    terms.push(`address.ilike.*${text}*`);
  }
  return terms.length > 0 ? terms.join(",") : NOTHING;
}

/** The search text with the or() syntax characters removed. */
export function textTerm(needle: string): string {
  return needle.replace(/[,()"\\*%:]/g, " ").replace(/\s+/g, " ").trim();
}

/** A LIKE pattern for "contains this", with LIKE's own wildcards escaped. */
export function containsPattern(needle: string): string {
  return `%${needle.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
