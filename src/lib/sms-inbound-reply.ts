import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { phoneKey } from "@/lib/sms-inbound";
import { maskPhone } from "@/lib/log-redact";
import { allPages, type Page } from "@/lib/supabase/all-pages";

/**
 * A real reply to one of the company's texts: kept, and put in front of the
 * office.
 *
 * Until 2026-11-11 the inbound webhook acted on STOP / START / HELP and threw
 * everything else away — "running 10 minutes late", "can we move to
 * Thursday?" — stored nowhere and shown to nobody. Svit's texts go mostly to
 * cleaners (forgotten clock-outs) and freelancers (open shifts), the people
 * most likely to answer.
 *
 * Now each reply is written to sms_messages (direction 'inbound', which the
 * table has allowed since it was made) and the owners, admins and managers
 * get it in the app, plus email so it lands for a manager with no push. The
 * email is limited to one per sender per 30 minutes; every message is still
 * saved and shown in the app. Nothing is texted back.
 *
 * Twilio can deliver the same message twice (a retry after a slow answer).
 * The message's SID makes both the saved row and the notification happen
 * once.
 */

export const REPLY_EMAIL_WINDOW_MS = 30 * 60 * 1000;

export type InboundReply = {
  to: string | null;
  from: string | null;
  body: string;
  messageSid: string | null;
  mediaCount: number;
  /** The message led with an opt-out word, so it also unsubscribed them. */
  optedOut?: boolean;
};

/** Longest SMS Twilio delivers (10 segments); nothing real is cut. */
const MAX_QUOTED = 1600;


export type Sender =
  | { kind: "client"; id: string; name: string }
  | { kind: "member"; id: string; name: string }
  | { kind: "freelancer"; id: string; name: string }
  | { kind: "unknown" };

type AdminDb = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Everyone in this company who might text the company's number, by phone
 * (last 10 digits). Clients win a shared number: they are who the office
 * answers to. Then active team members, then the on-call pool. The inbox
 * page reads it once for every reply it shows.
 */
export async function senderDirectory(db: AdminDb, organizationId: string): Promise<Map<string, Sender>> {
  const dir = new Map<string, Sender>();
  const add = (phone: string | null | undefined, sender: Sender) => {
    const key = phoneKey(phone);
    if (key.length === 10 && !dir.has(key)) dir.set(key, sender);
  };

  type ClientRow = { id: string; name: string | null; phone: string | null };
  const clients = await allPages<ClientRow>(
    (from, to) =>
      db
        .from("clients")
        .select("id, name, phone")
        .eq("organization_id", organizationId)
        .not("phone", "is", null)
        .order("id")
        .range(from, to) as unknown as Page<ClientRow>,
    "clients",
  );
  for (const c of clients) add(c.phone, { kind: "client", id: c.id, name: c.name?.trim() || "a client" });

  type MemberRow = {
    id: string;
    display_name: string | null;
    contact_phone: string | null;
    profile: { full_name: string | null; phone: string | null } | null;
  };
  const members = await allPages<MemberRow>(
    (from, to) =>
      db
        .from("memberships")
        .select("id, display_name, contact_phone, profile:profiles ( full_name, phone )")
        .eq("organization_id", organizationId)
        .eq("status", "active")
        .order("id")
        .range(from, to) as unknown as Page<MemberRow>,
    "memberships",
  );
  for (const m of members) {
    const sender: Sender = {
      kind: "member",
      id: m.id,
      name: m.display_name?.trim() || m.profile?.full_name?.trim() || "a team member",
    };
    add(m.contact_phone, sender);
    add(m.profile?.phone, sender);
  }

  type BenchRow = { id: string; full_name: string | null; phone: string | null };
  const bench = await allPages<BenchRow>(
    (from, to) =>
      db
        .from("freelancer_contacts")
        .select("id, full_name, phone")
        .eq("organization_id", organizationId)
        .order("id")
        .range(from, to) as unknown as Page<BenchRow>,
    "freelancer_contacts",
  );
  for (const b of bench) add(b.phone, { kind: "freelancer", id: b.id, name: b.full_name?.trim() || "a freelancer" });

  return dir;
}

/** Who, in this company, has the number a reply came from. */
export async function identifySender(
  db: AdminDb,
  organizationId: string,
  from: string | null,
): Promise<Sender> {
  const key = phoneKey(from);
  if (key.length !== 10) return { kind: "unknown" };
  return (await senderDirectory(db, organizationId)).get(key) ?? { kind: "unknown" };
}

/** Where a sender's page is in the office app; unknown numbers go to the inbox. */
export function senderHref(sender: Sender): string {
  return sender.kind === "client"
    ? `/app/clients/${sender.id}`
    : sender.kind === "member"
      ? `/app/employees/${sender.id}`
      : sender.kind === "freelancer"
        ? "/app/freelancers"
        : "/app/texts";
}

/** "(780) 555-0142" from "+17805550142"; anything else as it came. */
export function displayPhone(raw: string | null): string {
  const key = phoneKey(raw);
  return key.length === 10 ? `(${key.slice(0, 3)}) ${key.slice(3, 6)}-${key.slice(6)}` : (raw ?? "an unknown number");
}

export function describeReply(sender: Sender, reply: Pick<InboundReply, "from" | "body" | "mediaCount" | "optedOut">): {
  title: string;
  body: string;
  href: string;
} {
  const number = displayPhone(reply.from);
  const who =
    sender.kind === "client"
      ? `${sender.name} (client)`
      : sender.kind === "member"
        ? sender.name
        : sender.kind === "freelancer"
          ? `${sender.name} (freelancer)`
          : number;
  const text = reply.body.trim();
  const media = reply.mediaCount > 0 ? `[sent ${reply.mediaCount === 1 ? "a picture or file" : `${reply.mediaCount} pictures or files`}]` : "";
  const quoted = text ? `“${text.length > MAX_QUOTED ? `${text.slice(0, MAX_QUOTED - 1)}…` : text}”` : "";
  const unsubscribed = reply.optedOut
    ? "This also unsubscribed them from texts; they can text START to undo it."
    : "";
  const href = senderHref(sender);
  return {
    title: `Text from ${who}`,
    body: [quoted, media, sender.kind === "unknown" ? "" : `From ${number}.`, unsubscribed].filter(Boolean).join(" "),
    href,
  };
}

/**
 * Save the reply and tell the office. Returns what happened, for the log and
 * the tests. Throws only when it cannot tell what it should do (a read
 * failed); the caller still answers Twilio.
 */
export async function recordInboundReply(
  db: AdminDb,
  organizationId: string,
  reply: InboundReply,
): Promise<{ saved: boolean; duplicate: boolean; emailed: boolean; sender: Sender["kind"] }> {
  if (reply.messageSid) {
    const { data: seen, error: seenErr } = (await db
      .from("sms_messages" as never)
      .select("id")
      .eq("organization_id", organizationId)
      .eq("twilio_sid", reply.messageSid)
      .limit(1)) as unknown as { data: Array<{ id: string }> | null; error: { message: string } | null };
    if (seenErr) throw new Error(`sms_messages: ${seenErr.message}`);
    if ((seen ?? []).length > 0) return { saved: false, duplicate: true, emailed: false, sender: "unknown" };
  }

  const sender = await identifySender(db, organizationId, reply.from);
  const since = new Date(Date.now() - REPLY_EMAIL_WINDOW_MS).toISOString();
  const fromNumber = reply.from ?? "";

  // Save first. The webhook runs fail-closed, so a failed insert throws
  // rather than returning an error; catch it, because losing the log row is
  // better than losing the reply. 23505 is the unique index on the message
  // SID (20261111030000): the same message delivered twice at once, already
  // in hand.
  const { allowDbErrors } = await import("@/lib/supabase/query-guard");
  let savedId: string | null = null;
  try {
    const { data, error } = (await allowDbErrors(
      ["23505"],
      db
        .from("sms_messages" as never)
        .insert({
          organization_id: organizationId,
          direction: "inbound",
          to_number: reply.to ?? "",
          from_number: reply.from,
          body: reply.body || (reply.mediaCount > 0 ? "[picture or file]" : ""),
          status: "received",
          twilio_sid: reply.messageSid,
          client_id: sender.kind === "client" ? sender.id : null,
        } as never)
        .select("id")
        .single(),
    )) as unknown as { data: { id: string } | null; error: { code?: string; message: string } | null };
    if (error?.code === "23505") return { saved: false, duplicate: true, emailed: false, sender: sender.kind };
    if (error) throw new Error(error.message);
    savedId = data?.id ?? null;
  } catch (err) {
    console.error(`[sms/inbound] saving reply from ${maskPhone(reply.from)} failed:`, err);
  }

  // One email per sender per half hour. Decided after saving: the email goes
  // with the earliest of this number's replies in the window, so a text and
  // a picture arriving together email once, not twice (two requests that
  // each counted "none yet" before either saved used to both email). If the
  // save failed, fall back to "nothing from them in the window".
  let emailed = false;
  try {
    const { data: first } = (await db
      .from("sms_messages" as never)
      .select("id")
      .eq("organization_id", organizationId)
      .eq("direction", "inbound")
      .eq("from_number", fromNumber)
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(1)) as unknown as { data: Array<{ id: string }> | null };
    const earliest = first?.[0]?.id ?? null;
    emailed = savedId ? earliest === savedId : earliest === null;
  } catch (err) {
    // Can't tell; the app notification still goes.
    console.error(`[sms/inbound] email check for ${maskPhone(reply.from)} failed:`, err);
  }

  const { notify } = await import("@/lib/notify");
  await notify({
    organizationId,
    audience: "org-management",
    ...describeReply(sender, reply),
    channels: { inApp: true, push: true, email: emailed },
    ...(reply.messageSid ? { fact: `sms_reply:${reply.messageSid}` } : {}),
  });

  return { saved: savedId !== null, duplicate: false, emailed, sender: sender.kind };
}
