/**
 * Leads: the vocabulary, in one place.
 *
 * Pure — no database. The rules about what a lead is, what stages exist, and
 * what a legal move looks like live here so the page, the actions, the web-form
 * intake and the sidebar count can't drift into three different opinions about
 * whether a lost lead is still a lead.
 */

export type Lifecycle = "lead" | "client" | "lost";
export type LeadStage = "new" | "contacted" | "quoted";
export type LeadSource = "web_form" | "phone" | "email" | "referral" | "other";

/**
 * What an existing row is when nobody said otherwise.
 *
 * 'client' — the opposite default from most things I add, and deliberate: this
 * column landed on a table with 79 live rows, and anything other than 'client'
 * would have emptied her client list the morning the migration ran.
 */
export const DEFAULT_LIFECYCLE: Lifecycle = "client";

export const LEAD_STAGES: ReadonlyArray<{
  key: LeadStage;
  label: string;
  hint: string;
}> = [
  { key: "new", label: "New", hint: "Asked, nobody has replied yet" },
  { key: "contacted", label: "Contacted", hint: "Spoken to, no price given" },
  { key: "quoted", label: "Quoted", hint: "Price is with them, waiting" },
];

export const LEAD_SOURCES: ReadonlyArray<{
  key: LeadSource;
  label: string;
}> = [
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "web_form", label: "Website form" },
  { key: "referral", label: "Referral" },
  { key: "other", label: "Other" },
];

/**
 * Phone first in that list, on purpose. It's the channel software can never
 * capture, so it's the one a human will be typing most often — and the default
 * should be the common case, not the alphabetical one.
 */
export const DEFAULT_LEAD_SOURCE: LeadSource = "phone";

const STAGE_KEYS = new Set<string>(LEAD_STAGES.map((s) => s.key));
const SOURCE_KEYS = new Set<string>(LEAD_SOURCES.map((s) => s.key));

/** Read the column. Anything unrecognized reads as a client — see DEFAULT. */
export function parseLifecycle(raw: unknown): Lifecycle {
  return raw === "lead" || raw === "lost" ? raw : "client";
}

/** NULL for anyone who isn't a lead; unknown values fall back to 'new'. */
export function parseLeadStage(raw: unknown): LeadStage {
  return typeof raw === "string" && STAGE_KEYS.has(raw)
    ? (raw as LeadStage)
    : "new";
}

export function parseLeadSource(raw: unknown): LeadSource {
  return typeof raw === "string" && SOURCE_KEYS.has(raw)
    ? (raw as LeadSource)
    : "other";
}

export function stageLabel(stage: LeadStage): string {
  return LEAD_STAGES.find((s) => s.key === stage)?.label ?? "New";
}

export function sourceLabel(source: LeadSource): string {
  return LEAD_SOURCES.find((s) => s.key === source)?.label ?? "Other";
}

/**
 * A lead is only a lead while it's open.
 *
 * The single rule the whole feature rests on. Written once so nobody re-derives
 * it as `lifecycle !== 'client'` somewhere and quietly puts lost leads back in
 * the working list.
 */
export function isOpenLead(lifecycle: unknown): boolean {
  return parseLifecycle(lifecycle) === "lead";
}

/** Whether this person belongs in the CLIENT list. */
export function isClient(lifecycle: unknown): boolean {
  return parseLifecycle(lifecycle) === "client";
}

/**
 * Moving a lead along.
 *
 * Stages are a sequence, but movement is not restricted to forwards — she will
 * absolutely need to put a lead back to "contacted" after quoting the wrong
 * thing, and a pipeline that refuses is a pipeline she works around. The only
 * genuine rule is that stage means nothing once someone is won or lost.
 */
export function canSetStage(lifecycle: unknown): boolean {
  return isOpenLead(lifecycle);
}

/**
 * The lifecycle change for "they said yes".
 *
 * Returns the full patch rather than just the lifecycle so every caller clears
 * the stage too — a converted client carrying lead_stage = 'quoted' forever is
 * the kind of residue that later reads as a bug.
 */
export function conversionPatch(): {
  lifecycle: Lifecycle;
  lead_stage: null;
} {
  return { lifecycle: "client", lead_stage: null };
}

/** The patch for "they went elsewhere". Stage is kept for post-mortems. */
export function lostPatch(): { lifecycle: Lifecycle } {
  return { lifecycle: "lost" };
}

/** The patch for a brand-new lead, whatever channel it arrived through. */
export function newLeadPatch(source: LeadSource): {
  lifecycle: Lifecycle;
  lead_stage: LeadStage;
  lead_source: LeadSource;
} {
  return { lifecycle: "lead", lead_stage: "new", lead_source: source };
}

/**
 * Normalize the quick-add form.
 *
 * A NAME is the only requirement, and that is the whole design of this feature:
 * phone and email leads can only ever be entered by hand, so if adding one is
 * slower than writing it on paper, paper wins and the leads list stays empty.
 * Everything else is optional and trimmed to null.
 */
export function parseQuickAdd(input: {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  note?: unknown;
  source?: unknown;
}):
  | {
      ok: true;
      value: {
        name: string;
        phone: string | null;
        email: string | null;
        lead_note: string | null;
        lead_source: LeadSource;
      };
    }
  | { ok: false; error: string } {
  const name = String(input.name ?? "").trim();
  if (!name) return { ok: false, error: "A name is the one thing I need." };

  const clean = (v: unknown) => {
    const s = String(v ?? "").trim();
    return s.length > 0 ? s : null;
  };

  return {
    ok: true,
    value: {
      name,
      phone: clean(input.phone),
      email: clean(input.email),
      lead_note: clean(input.note),
      lead_source: input.source
        ? parseLeadSource(input.source)
        : DEFAULT_LEAD_SOURCE,
    },
  };
}
