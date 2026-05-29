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
export function detectCardNumber(input: string): DetectedCard | null {
  if (!input) return null;

  // Strategy: walk the original text collecting runs of "digit or
  // separator", then strip separators from each run and test sliding
  // windows of 13-19 digits against Luhn. Stops at the first match.
  const SEPARATORS = /[\s\-.]/;
  let run = "";
  for (let i = 0; i <= input.length; i++) {
    const ch = i < input.length ? input[i] : "";
    if (/\d/.test(ch)) {
      run += ch;
    } else if (SEPARATORS.test(ch)) {
      // separator inside a run — drop it, keep walking
      continue;
    } else {
      // boundary: test the run we accumulated
      const hit = scanRun(run);
      if (hit) return hit;
      run = "";
    }
  }
  return null;
}

function scanRun(run: string): DetectedCard | null {
  if (run.length < 13) return null;
  for (let len = 13; len <= 19; len++) {
    for (let start = 0; start + len <= run.length; start++) {
      const candidate = run.slice(start, start + len);
      if (luhnCheck(candidate)) {
        return {
          pan: candidate,
          lastFour: candidate.slice(-4),
        };
      }
    }
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
