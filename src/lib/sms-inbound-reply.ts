import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { phoneKey } from "@/lib/sms-inbound";
import { maskPhone } from "@/lib/log-redact";

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
};

export type Sender =
  | { kind: "client"; id: string; name: string }
  | { kind: "member"; id: string; name: string }
  | { kind: "freelancer"; id: string; name: string }
  | { kind: "unknown" };

type AdminDb = ReturnType<typeof createSupabaseAdminClient>;

/** Who, in this company, has the number a reply came from. Clients first: they are who the office answers to. */
export async function identifySender(
  db: AdminDb,
  organizationId: string,
  from: string | null,
): Promise<Sender> {
  const key = phoneKey(from);
  if (key.length !== 10) return { kind: "unknown" };

  const { data: clients, error: clientsErr } = (await db
    .from("clients")
    .select("id, name, phone")
    .eq("organization_id", organizationId)
    .not("phone", "is", null)) as unknown as {
    data: Array<{ id: string; name: string | null; phone: string | null }> | null;
    error: { message: string } | null;
  };
  if (clientsErr) throw new Error(`clients: ${clientsErr.message}`);
  const client = (clients ?? []).find((c) => phoneKey(c.phone) === key);
  if (client) return { kind: "client", id: client.id, name: client.name?.trim() || "a client" };

  const { data: members, error: membersErr } = (await db
    .from("memberships")
    .select("id, display_name, contact_phone, profile:profiles ( full_name, phone )")
    .eq("organization_id", organizationId)
    .eq("status", "active")) as unknown as {
    data: Array<{
      id: string;
      display_name: string | null;
      contact_phone: string | null;
      profile: { full_name: string | null; phone: string | null } | null;
    }> | null;
    error: { message: string } | null;
  };
  if (membersErr) throw new Error(`memberships: ${membersErr.message}`);
  const member = (members ?? []).find(
    (m) => phoneKey(m.contact_phone) === key || phoneKey(m.profile?.phone) === key,
  );
  if (member) {
    return {
      kind: "member",
      id: member.id,
      name: member.display_name?.trim() || member.profile?.full_name?.trim() || "a team member",
    };
  }

  const { data: bench, error: benchErr } = (await db
    .from("freelancer_contacts")
    .select("id, full_name, phone")
    .eq("organization_id", organizationId)) as unknown as {
    data: Array<{ id: string; full_name: string | null; phone: string | null }> | null;
    error: { message: string } | null;
  };
  if (benchErr) throw new Error(`freelancer_contacts: ${benchErr.message}`);
  const freelancer = (bench ?? []).find((f) => phoneKey(f.phone) === key);
  if (freelancer) {
    return { kind: "freelancer", id: freelancer.id, name: freelancer.full_name?.trim() || "a freelancer" };
  }

  return { kind: "unknown" };
}

/** "(780) 555-0142" from "+17805550142"; anything else as it came. */
export function displayPhone(raw: string | null): string {
  const key = phoneKey(raw);
  return key.length === 10 ? `(${key.slice(0, 3)}) ${key.slice(3, 6)}-${key.slice(6)}` : (raw ?? "an unknown number");
}

export function describeReply(sender: Sender, reply: Pick<InboundReply, "from" | "body" | "mediaCount">): {
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
  const quoted = text ? `“${text.length > 300 ? `${text.slice(0, 299)}…` : text}”` : "";
  const href =
    sender.kind === "client"
      ? `/app/clients/${sender.id}`
      : sender.kind === "member"
        ? `/app/employees/${sender.id}`
        : sender.kind === "freelancer"
          ? "/app/freelancers"
          : "/app";
  return {
    title: `Text from ${who}`,
    body: [quoted, media, sender.kind === "unknown" ? "" : `From ${number}.`].filter(Boolean).join(" "),
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

  // Did this number already reply in the last half hour? Then the office was
  // emailed about it; this one goes to the app only.
  const since = new Date(Date.now() - REPLY_EMAIL_WINDOW_MS).toISOString();
  const { count: recent, error: recentErr } = (await db
    .from("sms_messages" as never)
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("direction", "inbound")
    .eq("from_number", reply.from ?? "")
    .gte("created_at", since)) as unknown as { count: number | null; error: { message: string } | null };
  if (recentErr) throw new Error(`sms_messages: ${recentErr.message}`);

  const { error: insErr } = (await db.from("sms_messages" as never).insert({
    organization_id: organizationId,
    direction: "inbound",
    to_number: reply.to ?? "",
    from_number: reply.from,
    body: reply.body || (reply.mediaCount > 0 ? "[picture or file]" : ""),
    status: "received",
    twilio_sid: reply.messageSid,
    client_id: sender.kind === "client" ? sender.id : null,
  } as never)) as unknown as { error: { message: string } | null };
  if (insErr) {
    // Still tell the office: losing the log row is better than losing the reply.
    console.error(`[sms/inbound] saving reply from ${maskPhone(reply.from)} failed:`, insErr.message);
  }

  const emailed = (recent ?? 0) === 0;
  const { notify } = await import("@/lib/notify");
  await notify({
    organizationId,
    audience: "org-management",
    ...describeReply(sender, reply),
    channels: { inApp: true, push: true, email: emailed },
    ...(reply.messageSid ? { fact: `sms_reply:${reply.messageSid}` } : {}),
  });

  return { saved: !insErr, duplicate: false, emailed, sender: sender.kind };
}
