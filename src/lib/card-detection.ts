/**
 * Card-number detection for free-text inputs.
 *
 * PCI-DSS treats *any* table that stores a PAN as cardholder-data
 * storage — even if the PAN got there because a user pasted it into a
 * notes field rather than because we asked for it. This module gives
 * the server-side validation layer a way to reject that input before
 * persisting it.
 *
 * Algorithm:
 *   1. Strip non-digit characters from the input (people paste
 *      "4242-4242-4242-4242" or "4242 4242 4242 4242" with separators).
 *   2. Find every 13-19 digit sequence (the PAN length range per ISO
 *      7812). Use a sliding window on the digit-only string so spaced
 *      "4242 4242 4242 4242" is detected even though no continuous
 *      digit sub-string of the original passes Luhn alone.
 *   3. Run Luhn checksum on each candidate. A real card number must
 *      pass; random digits almost never do (1-in-10 false positive at
 *      random, but real data — phone numbers, invoice numbers, dates —
 *      almost never Luhn-validates).
 *
 * Returns the first detected card (so callers can show "Detected a card
 * number ending in 1234" if helpful) or null.
 *
 * Acceptable last-four-style references ("Visa ending in 4242", "card
 * ****1234") pass through unblocked because the digit sequences are
 * < 13 characters.
 */

/** Luhn check on a digit string. Empty string returns false. */
export function luhnCheck(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  if (!/^\d+$/.test(digits)) return false;

  let sum = 0;
  let isSecond = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48; // ASCII '0' = 48
    if (d < 0 || d > 9) return false;
    if (isSecond) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    isSecond = !isSecond;
  }
  return sum % 10 === 0;
}

export type DetectedCard = {
  /** Full PAN matched (kept ONLY for server-side log/audit; never echo back) */
  pan: string;
  /** Last four digits — safe to display in error messages */
  lastFour: string;
};

/**
 * Scan free-text input for a payment card number.
 *
 * Returns the first Luhn-validated 13-19 digit sequence found, or null
 * if the input is clean. Strips separators (spaces, hyphens, dots)
 * before scanning so "4242-4242-4242-4242" matches.
 */
/**
 * Candidate PAN shape: 13-19 digits written the way cards actually are —
 * contiguous, or in groups separated by a SINGLE space or hyphen
 * ("4242424242424242", "4242 4242 4242 4242", "4242-4242-4242-4242").
 *
 * The lookarounds require the WHOLE digit run to be 13-19 long, so a card-shaped
 * slice can't be carved out of a longer id number.
 *
 * PREVIOUS BUG (fixed here): the old scanner skipped every whitespace, hyphen
 * AND period, concatenating every number in the field into one long run, then
 * Luhn-tested every 13-19 digit sub-window of it. With ~21 overlapping
 * candidates per 18-digit run that falsely flagged ~89% of ordinary notes —
 * "Gate 4521 Alarm 5678 Lockbox 3344", "07-21-2026 780-555-0199" — and because
 * this refine gates the whole booking form, the entire save was silently
 * rejected. Newlines and periods are now boundaries between DIFFERENT numbers.
 */
const PAN_CANDIDATE = /(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g;

/**
 * Major-brand IIN (issuer) prefixes. A real PAN always starts with one; gate
 * codes and dates almost never do. Combined with Luhn on the exact run (not a
 * sliding window), this drops the false-positive rate to near zero while still
 * catching every genuine pasted card.
 */
function hasCardPrefix(pan: string): boolean {
  return (
    /^4/.test(pan) || // Visa
    /^5[1-5]/.test(pan) || // Mastercard
    /^2(2[2-9]|[3-6]\d|7[01]|720)/.test(pan) || // Mastercard 2-series
    /^3[47]/.test(pan) || // Amex
    /^6(011|5|4[4-9]|22)/.test(pan) || // Discover / UnionPay
    /^3(0[0-5]|[689])/.test(pan) // Diners / JCB
  );
}

export function detectCardNumber(input: string): DetectedCard | null {
  if (!input) return null;

  for (const match of input.matchAll(PAN_CANDIDATE)) {
    const pan = match[0].replace(/[ -]/g, "");
    if (pan.length < 13 || pan.length > 19) continue;
    if (!hasCardPrefix(pan)) continue;
    if (!luhnCheck(pan)) continue;
    return { pan, lastFour: pan.slice(-4) };
  }
  return null;
}

/**
 * Zod-friendly refine helper. Use as:
 *
 *   z.string().refine(noCardNumber, { message: "..." })
 *
 * Returns true when the input is SAFE (no card detected). Returns
 * false when a card is detected — Zod treats this as a failed
 * validation.
 */
export function noCardNumber(input: unknown): boolean {
  if (typeof input !== "string") return true;
  return detectCardNumber(input) === null;
}

/** Standard rejection message to show users when card data is detected. */
export const CARD_DETECTED_MESSAGE =
  "Don't store card numbers here. Have the client pay via the Stripe link on the invoice instead.";
