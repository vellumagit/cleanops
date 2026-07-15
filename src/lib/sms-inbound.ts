import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Pure helpers for the inbound-SMS webhook (`/api/sms/inbound`). Kept
 * dependency-light (only node:crypto) so the security-critical signature check
 * and the opt-out keyword parsing are unit-testable in isolation.
 */

export type InboundIntent = "stop" | "start" | "help" | "other";

const STOP_KEYWORDS = new Set([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
  "OPTOUT",
  "REVOKE",
]);
const START_KEYWORDS = new Set(["START", "YES", "UNSTOP", "OPTIN"]);
const HELP_KEYWORDS = new Set(["HELP", "INFO"]);

/**
 * Classify an inbound SMS body by its first word (carriers key opt-out on the
 * first keyword, case-insensitive). Everything else is "other" — a real reply.
 */
export function classifyInboundSms(
  body: string | null | undefined,
): InboundIntent {
  const first = (body ?? "").trim().split(/\s+/)[0]?.toUpperCase() ?? "";
  if (STOP_KEYWORDS.has(first)) return "stop";
  if (START_KEYWORDS.has(first)) return "start";
  if (HELP_KEYWORDS.has(first)) return "help";
  return "other";
}

/** Last 10 digits, so "+15551234567" / "(555) 123-4567" / "5551234567" match. */
export function phoneKey(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D/g, "").slice(-10);
}

/**
 * Validate Twilio's X-Twilio-Signature. Twilio signs the exact configured
 * webhook URL with the POST params (sorted by key, name+value concatenated),
 * HMAC-SHA1 with the auth token, base64. We test against each candidate URL
 * (the configured base + the request host) so a base-URL change doesn't lock us
 * out. Uses a constant-time compare.
 */
export function verifyTwilioSignature(args: {
  candidateUrls: string[];
  params: URLSearchParams;
  signature: string | null;
  authToken: string;
}): boolean {
  if (!args.signature) return false;

  const sortedConcat = [...args.params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .reduce((acc, [k, v]) => acc + k + v, "");

  const provided = Buffer.from(args.signature);
  for (const url of args.candidateUrls) {
    const expected = Buffer.from(
      createHmac("sha1", args.authToken)
        .update(Buffer.from(url + sortedConcat, "utf-8"))
        .digest("base64"),
    );
    if (
      expected.length === provided.length &&
      timingSafeEqual(expected, provided)
    ) {
      return true;
    }
  }
  return false;
}
