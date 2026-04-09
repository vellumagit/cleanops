/**
 * Claim token generator — one per `job_offer_dispatches` row.
 *
 * Each freelancer who gets a shift offer receives a unique URL-safe token
 * that identifies both the offer AND which contact is claiming. The token
 * IS the capability: the /claim/:token page has no auth, so the only
 * thing proving "you're the freelancer this was sent to" is knowing the
 * random string.
 *
 * Format: 16 URL-safe base64 chars = 96 bits of entropy. That's ~79 billion
 * billion values — guessing one is not feasible even at web scale. Using
 * Node's crypto module (not Math.random) because this is a security boundary.
 *
 * Example output: "aK7_bQx9-Yn2pV3E"
 */

import "server-only";
import { randomBytes } from "node:crypto";

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function generateClaimToken(length = 16): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return out;
}
