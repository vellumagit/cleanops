/**
 * Searching the bookings list on the server.
 *
 * The list used to search only the rows it had already loaded: the newest
 * 1,000 bookings. A company with a year of recurring visits booked ahead
 * has more than 1,000 bookings from today on, so a client's past visits
 * were never among them, and searching "Brian" on Past or All showed only
 * what was coming (2026-11-25). Past and All now ask the database for the
 * matching bookings themselves, across the whole history.
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
