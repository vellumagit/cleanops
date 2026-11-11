import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * The link a client follows to leave a review, made so that nothing in the
 * database is enough to forge one.
 *
 * It used to be a random token stored in bookings.review_token (and
 * invoices.review_token), and the review page accepted whoever presented the
 * stored value. Every member of a company can read both tables through the
 * API, so a cleaner could read the token for her own job, open the link and
 * give herself five stars; review bonuses pay money (security audit, Batch B,
 * confirmed 2026-11-10).
 *
 * Two kinds of link are accepted now, and neither can be made from what the
 * database shows:
 *
 *   signed   "r1.b.<booking id>.<signature>"  /  "r1.i.<invoice id>.<signature>"
 *            The signature is an HMAC over the kind and the id with a key
 *            only the server holds. Nothing is stored; any server path that
 *            needs the link again recomputes the same one, so re-sending
 *            never invalidates the link already in someone's inbox.
 *
 *   legacy   the random tokens already emailed. The column keeps only their
 *            SHA-256 ("sha256:<hex>", migration 20261110050000), so the link
 *            in the email still works and the stored value is useless: it is
 *            not the token, and presenting it is refused outright.
 *
 * The column still gets a value when a link is first issued, because other
 * code reads "is there one?" from it. That value is the hash of the signed
 * token: a marker, not a secret.
 */
export type ReviewSource = "booking" | "invoice";

const KIND: Record<ReviewSource, string> = { booking: "b", invoice: "i" };
const SOURCE: Record<string, ReviewSource> = { b: "booking", i: "invoice" };
const STORED_PREFIX = "sha256:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * REVIEW_LINK_SECRET if set, else a key derived from the service-role key,
 * which every deployment already has and which never leaves the server.
 * Rotating whichever is in use invalidates outstanding signed links, which
 * expire after 60 days anyway.
 */
function signingKey(): Buffer {
  const base = process.env.REVIEW_LINK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base) throw new Error("review links need REVIEW_LINK_SECRET or SUPABASE_SERVICE_ROLE_KEY");
  return createHmac("sha256", base).update("sollos:review-link:v1").digest();
}

function signature(source: ReviewSource, id: string): string {
  return createHmac("sha256", signingKey())
    .update(`${source}:${id.toLowerCase()}`)
    .digest("base64url")
    .slice(0, 32);
}

const same = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** The review link token for this job or invoice. Always the same one. */
export function reviewLinkToken(source: ReviewSource, id: string): string {
  return `r1.${KIND[source]}.${id.toLowerCase()}.${signature(source, id)}`;
}

/** What a signed token names, or null when it is not one or the signature is wrong. */
export function parseReviewLinkToken(token: string): { source: ReviewSource; id: string } | null {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "r1") return null;
  const source = SOURCE[parts[1]];
  const id = parts[2];
  if (!source || !UUID.test(id)) return null;
  return same(parts[3], signature(source, id)) ? { source, id: id.toLowerCase() } : null;
}

/** What the column holds for a token: its hash, never the token. */
export function storedReviewToken(token: string): string {
  return STORED_PREFIX + createHash("sha256").update(token).digest("hex");
}

/**
 * The values a LEGACY token could be stored as, for looking its row up:
 * hashed (after the migration) or plain (a row the migration has not reached).
 * Empty for anything that looks like a stored value, so the hash read out of
 * the database can never be presented as the token.
 */
export function legacyStoredForms(token: string): string[] {
  if (!token || token.startsWith(STORED_PREFIX)) return [];
  return [storedReviewToken(token), token];
}

/** Does this legacy token belong to the row whose column holds `stored`? */
export function legacyTokenMatches(stored: string | null | undefined, token: string): boolean {
  if (!stored || !token || token.startsWith(STORED_PREFIX)) return false;
  return stored.startsWith(STORED_PREFIX) ? same(stored, storedReviewToken(token)) : same(stored, token);
}

/**
 * The one question the review form's submit asks: was this token issued for
 * this job or invoice? `stored` is the row's review_token column.
 */
export function reviewTokenIsFor(
  token: string,
  source: ReviewSource,
  id: string,
  stored: string | null | undefined,
): boolean {
  const signed = parseReviewLinkToken(token);
  if (signed) return signed.source === source && signed.id === id.toLowerCase();
  return legacyTokenMatches(stored, token);
}
