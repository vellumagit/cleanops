/**
 * Social and chat leads: reading what ManyChat, GoHighLevel, Zapier & co send.
 *
 * Pure — no database. The route (src/app/api/social-lead/[token]/route.ts)
 * does the writing; this decides what a payload MEANS.
 *
 * Website forms send the field names we told them to. Chat tools don't: each
 * one posts its own shape, and the person setting it up is an owner clicking
 * through a ManyChat or GoHighLevel screen, not a developer. So this reads
 * the shapes those tools send by default as well as the plain names:
 *
 *   ManyChat "Full Contact Data"  name, first_name, last_name, email, phone,
 *                                 ig_username, whatsapp_phone, last_input_text,
 *                                 id, custom_fields{…}
 *   GoHighLevel workflow webhook  full_name, first_name, last_name, email,
 *                                 phone, contact_id, contact_source, city,
 *                                 address1, customData{…}
 *   Anything hand-built           name, email, phone, message, channel, …
 *
 * Top-level fields win; one level of nesting (customData, custom_fields,
 * contact) is read after, because that's where both tools put the fields an
 * owner adds by hand.
 *
 * There is no spam trap here. The website forms treat a filled-in `website`
 * field as a bot; a GoHighLevel contact HAS a website field, and reading it
 * that way silently threw real leads away. These posts come from a chat
 * tool's server holding a private URL, not from a public web page.
 */

import type { LeadSource } from "@/lib/lead-pipeline";

export type SocialLead = {
  name: string;
  email: string | null;
  phone: string | null;
  /** Which network they came from; "social" when the tool didn't say. */
  source: LeadSource;
  /** "@handle" on that network, when known. */
  handle: string | null;
  message: string | null;
  place: string | null;
  /** The chat tool's own id for this person, for finding them there later. */
  externalId: string | null;
  /** Whatever the tool calls itself, if it said ("ManyChat", "GoHighLevel"). */
  via: string | null;
};

export type SocialLeadResult =
  | { ok: true; lead: SocialLead }
  | { ok: false; error: "name_required" };

/** Objects whose fields count as if they were top-level, in this order. */
const NESTED = ["customdata", "custom_data", "custom_fields", "customfields", "contact", "data"];

/**
 * Flatten to one lowercase-keyed record. Top-level keys first, so a nested
 * copy never overrides what the tool sent at the top. Only strings and
 * numbers survive: an object or array is never a name or a phone number.
 */
function flatten(body: Record<string, unknown>): Map<string, string> {
  const out = new Map<string, string>();
  const take = (obj: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = k.toLowerCase();
      if (out.has(key)) continue;
      if (typeof v === "string" || typeof v === "number") {
        const s = String(v).trim();
        if (s) out.set(key, s);
      }
    }
  };
  take(body);
  for (const [k, v] of Object.entries(body)) {
    if (NESTED.includes(k.toLowerCase()) && v && typeof v === "object" && !Array.isArray(v)) {
      take(v as Record<string, unknown>);
    }
  }
  return out;
}

function pick(f: Map<string, string>, keys: string[], cap = 300): string | null {
  for (const k of keys) {
    const v = f.get(k);
    if (v) return v.slice(0, cap);
  }
  return null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Read a network out of free text: "Instagram", "IG DM", "facebook_ads",
 * "Messenger", "FB Lead Form", "tiktok"… Null when it names none of them,
 * so the caller can try the next clue.
 */
export function sourceFromText(raw: string | null | undefined): LeadSource | null {
  const t = (raw ?? "").toLowerCase();
  if (!t) return null;
  if (/insta|\big\b|^ig[\s_-]/.test(t)) return "instagram";
  if (/whats\s*app|\bwa\b/.test(t)) return "whatsapp";
  if (/tik\s*tok/.test(t)) return "tiktok";
  if (/facebook|messenger|\bfb\b|^fb[\s_-]|\bmeta\b/.test(t)) return "facebook";
  return null;
}

/** Strip a leading @ and anything that can't be in a handle, then add one @. */
function asHandle(raw: string | null): string | null {
  const h = (raw ?? "").trim().replace(/^@+/, "");
  if (!h || /\s/.test(h)) return null;
  return `@${h.slice(0, 60)}`;
}

export function parseSocialLead(body: unknown): SocialLeadResult {
  // A body of `null`, `"text"` or `[…]` parses as JSON but holds no person.
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "name_required" };
  }
  const f = flatten(body as Record<string, unknown>);

  const first = pick(f, ["first_name", "firstname", "first"], 100);
  const last = pick(f, ["last_name", "lastname", "last"], 100);
  const joined = [first, last].filter(Boolean).join(" ") || null;

  const igHandle = asHandle(pick(f, ["ig_username", "instagram_username", "instagram"], 80));
  const ttHandle = asHandle(pick(f, ["tiktok_username", "tiktok"], 80));
  const handle =
    igHandle ?? ttHandle ?? asHandle(pick(f, ["username", "handle", "social_handle"], 80));

  const rawEmail = pick(f, ["email", "email_address", "emailaddress", "optin_email"], 320);
  const email = rawEmail && EMAIL_RE.test(rawEmail) ? rawEmail : null;
  const whatsapp = pick(f, ["whatsapp_phone", "whatsapp"], 40);
  const phone = pick(f, ["phone", "phone_number", "mobile", "tel", "telephone", "optin_phone"], 40) ?? whatsapp;

  // A person needs SOME name to be a lead. Prefer what they're called; fall
  // back to how the office would recognise them in the chat tool.
  const name =
    pick(f, ["name", "full_name", "fullname", "contact_name"], 200) ??
    joined ??
    handle ??
    (email ? email.split("@")[0] : null) ??
    phone;
  if (!name) return { ok: false, error: "name_required" };

  // Which network: say-so first, then what the payload's shape gives away.
  const said = pick(f, ["channel", "platform", "source", "lead_source", "contact_source", "utm_source"], 100);
  const source: LeadSource =
    sourceFromText(said) ??
    (igHandle || f.has("ig_id") ? "instagram" : null) ??
    (ttHandle ? "tiktok" : null) ??
    (whatsapp ? "whatsapp" : null) ??
    "social";

  return {
    ok: true,
    lead: {
      name,
      email,
      phone,
      source,
      handle,
      message: pick(
        f,
        ["message", "notes", "note", "last_input_text", "question", "comments", "comment", "details", "inquiry"],
        2000,
      ),
      place: pick(f, ["city", "address", "address1", "location", "postal_code", "zip"], 200),
      externalId: pick(f, ["contact_id", "subscriber_id", "user_id", "id"], 100),
      via: pick(f, ["via", "tool", "integration"], 60),
    },
  };
}

/** "Instagram lead", "Facebook lead", "Social / chat lead". */
export function socialLeadTitle(source: LeadSource): string {
  switch (source) {
    case "instagram":
      return "Instagram lead";
    case "facebook":
      return "Facebook lead";
    case "tiktok":
      return "TikTok lead";
    case "whatsapp":
      return "WhatsApp lead";
    default:
      return "Social / chat lead";
  }
}

/**
 * The lines that go on the lead's note and the inbox item. Plain text; the
 * route escapes it wherever it lands in HTML.
 */
export function socialLeadDetails(lead: SocialLead): string[] {
  return [
    lead.message && `Message: ${lead.message}`,
    lead.handle && `Handle: ${lead.handle}`,
    lead.place && `Location: ${lead.place}`,
    lead.via && `Via: ${lead.via}`,
    lead.externalId && `Chat tool contact id: ${lead.externalId}`,
  ].filter(Boolean) as string[];
}
