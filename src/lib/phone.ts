/**
 * Phone number utilities.
 *
 * Twilio requires E.164 format (+15551234567) for all outbound SMS.
 * We normalise on the way in (server action / form save) so the stored
 * number is always in the right shape by the time it reaches Twilio.
 */

/**
 * Best-effort E.164 normalisation (North-America-first).
 *
 * Rules applied in order:
 *   1. Empty / whitespace-only → returned as-is (blank phone is valid).
 *   2. Already starts with "+" → strip non-digit chars after the "+",
 *      return "+{digits}" as long as there are ≥ 7 digits.
 *   3. 10 digits → "+1{digits}"  (North American, no country code)
 *   4. 11 digits starting with "1" → "+{digits}"  (NA with leading 1)
 *   5. Everything else → returned trimmed-but-unchanged. Twilio will
 *      reject it and the caller will surface the error.
 *
 * Why not a full libphonenumber parse? The library adds ~600 kB to the
 * bundle and 99 % of CleanOps clients are North American. Best-effort
 * covers the common cases; Twilio's API is the authoritative validator.
 */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;

  // Rule 2: already has a leading "+" — strip formatting chars only.
  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    return digits.length >= 7 ? `+${digits}` : trimmed;
  }

  const digits = trimmed.replace(/\D/g, "");

  // Rule 3: bare 10-digit NA number.
  if (digits.length === 10) return `+1${digits}`;

  // Rule 4: 11-digit with leading "1" country code.
  if (digits.length === 11 && digits[0] === "1") return `+${digits}`;

  // Rule 5: can't safely guess country code — return unchanged.
  return trimmed;
}

/**
 * Returns true when `phone` looks like a valid E.164 number:
 * a "+" followed by 7–15 digits (ITU-T E.164 max length).
 *
 * Used by sendSms() in twilio.ts to guard against sending to a
 * malformed number when TWILIO_ENABLED=true.
 */
export function isE164(phone: string): boolean {
  return /^\+\d{7,15}$/.test(phone);
}
