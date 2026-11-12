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
 * Classify an inbound SMS body (case and punctuation ignored). Opt-out words
 * count when they lead the message; START and HELP only when they are the
 * whole message. Everything else is "other" — a real reply for the office.
 * Until 2026-11-11 all three keyed on the first word alone.
 */
export function classifyInboundSms(
  body: string | null | undefined,
): InboundIntent {
  const { first, alone } = firstWord(body);
  // An opt-out word leads, with or without more: honoured either way, since
  // treating "Stop texting me" as anything but an opt-out is the costly
  // mistake. The route still passes any further words to the office, so
  // "Cancel my Friday clean" is not lost (it used to vanish).
  if (STOP_KEYWORDS.has(first)) return "stop";
  // START and HELP only when the keyword is the whole message. "Yes I can
  // take Saturday" is an answer for the office, not consent to texts, and
  // "Info on pricing?" is a question, not a request for the HELP blurb.
  if (alone && START_KEYWORDS.has(first)) return "start";
  if (alone && HELP_KEYWORDS.has(first)) return "help";
  return "other";
}

/**
 * True when a message says more than its keyword: "Cancel my Friday clean"
 * yes, "STOP." no. The route uses it to pass an opt-out's words on.
 */
export function saysMoreThanKeyword(body: string | null | undefined): boolean {
  const { first, alone } = firstWord(body);
  return first !== "" && !alone;
}

/** First word, upper-cased with punctuation dropped ("Stop!" → "STOP"), and whether it is all there is. */
function firstWord(body: string | null | undefined): { first: string; alone: boolean } {
  const words = (body ?? "").trim().split(/\s+/).filter(Boolean);
  // Letters and digits are words; punctuation and emoji are not ("Yes 2" is a reply).
  const strip = (w: string) => w.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const first = words[0] ? strip(words[0]) : "";
  // "Stop !" and "yes 👍" are still just the keyword.
  const alone = words.slice(1).every((w) => strip(w) === "");
  return { first, alone };
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
