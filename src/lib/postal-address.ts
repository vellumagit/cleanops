/**
 * Turn a freeform address string into the structured shape accounting
 * providers expect.
 *
 * Sollos stores addresses as one text field (clients.address,
 * bookings.address) because that is what a Google Places autocomplete hands
 * back and what an owner types by hand. Sage's address objects want
 * address_line_1 / city / region / postal_code / country_id as separate keys,
 * and Sage rejects a sales invoice outright when it cannot resolve an
 * address — "Invoice Address is required." with $source "base".
 *
 * This is deliberately forgiving. A parse that produces only address_line_1
 * is still a valid, postable address; the goal is never to lose information,
 * not to achieve a perfect structural split. Every real shape in the
 * production data is covered by the tests.
 */

export type PostalAddress = {
  address_line_1: string;
  address_line_2?: string;
  city?: string;
  /** Province/state code as written, e.g. "AB", "NY". */
  region?: string;
  postal_code?: string;
  /** ISO 3166-1 alpha-2, e.g. "CA", "US". */
  country_id?: string;
};

/** "T5E 4H2", "T5E4H2" — Canadian postal code. */
const CA_POSTAL = /^[A-Z]\d[A-Z][ -]?\d[A-Z]\d$/i;
/** "10118", "10118-1234" — US ZIP. */
const US_ZIP = /^\d{5}(-\d{4})?$/;
const TWO_LETTER = /^[A-Z]{2}$/i;

const COUNTRIES: Record<string, string> = {
  canada: "CA",
  ca: "CA",
  can: "CA",
  usa: "US",
  us: "US",
  "united states": "US",
  "united states of america": "US",
  uk: "GB",
  "united kingdom": "GB",
  gb: "GB",
};

function looksPostal(s: string): "CA" | "US" | null {
  if (CA_POSTAL.test(s)) return "CA";
  if (US_ZIP.test(s)) return "US";
  return null;
}

/**
 * Parse a freeform address.
 *
 * Returns null only when there is nothing usable at all — callers should
 * treat that as "cannot sync" rather than posting an empty address object,
 * which is what created Sage contacts with a literal `"main_address": {}`.
 */
export function parsePostalAddress(
  raw: string | null | undefined,
  fallbackCountryId?: string,
): PostalAddress | null {
  const text = (raw ?? "").trim();
  if (!text) return null;

  // Split on commas, but also rescue "…NW,Edmonton" (no space after comma),
  // which appears in the real data.
  const parts = text
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  let country: string | undefined;
  let postal: string | undefined;
  let region: string | undefined;
  const rest: string[] = [];

  for (const part of parts) {
    const lower = part.toLowerCase();

    if (COUNTRIES[lower]) {
      country = COUNTRIES[lower];
      continue;
    }

    const asPostal = looksPostal(part);
    if (asPostal) {
      postal = part.toUpperCase();
      country ??= asPostal;
      continue;
    }

    // A bare province/state code: "AB", "NY".
    if (TWO_LETTER.test(part)) {
      region = part.toUpperCase();
      continue;
    }

    // "AB T5E 4H2" / "NY 10118" — region and postal share one comma-part,
    // which is how Google Places formats Canadian and US addresses.
    const tokens = part.split(/\s+/);
    if (tokens.length >= 2 && TWO_LETTER.test(tokens[0])) {
      const tail = tokens.slice(1).join(" ");
      const tailPostal = looksPostal(tail);
      if (tailPostal) {
        region = tokens[0].toUpperCase();
        postal = tail.toUpperCase();
        country ??= tailPostal;
        continue;
      }
    }

    rest.push(part);
  }

  if (rest.length === 0) {
    // Everything parsed as metadata (e.g. just "Canada"). Not a usable
    // street address — say so rather than inventing one.
    return null;
  }

  const address_line_1 = rest[0];
  // With 2+ remaining parts the last is the city; anything between the street
  // and the city is a second address line (unit, building, etc.).
  const city = rest.length > 1 ? rest[rest.length - 1] : undefined;
  const middle = rest.slice(1, -1);
  const address_line_2 = middle.length ? middle.join(", ") : undefined;

  return {
    address_line_1,
    ...(address_line_2 ? { address_line_2 } : {}),
    ...(city ? { city } : {}),
    ...(region ? { region } : {}),
    ...(postal ? { postal_code: postal } : {}),
    ...(country || fallbackCountryId
      ? { country_id: country ?? fallbackCountryId }
      : {}),
  };
}
