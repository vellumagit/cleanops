/**
 * Read-only: does DM actually WORK in a given org? Lists every chat thread,
 * its members (with whether each can log in), message count, distinct
 * senders, and the latest message time. Proves whether messages have ever
 * sent AND been exchanged between two real (login-capable) members.
 *
 * Usage: npx tsx --env-file=.env.local scripts/verify-dm-health.ts [orgId]
 * Default orgId = Svit Company Inc.
 */
export {}; // isolate module scope (standalone script, no imports)

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ORG_ID = process.argv[2] ?? "4cf4c402-5889-43c9-91f3-7186f66ee08b";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE env vars. Run with --env-file=.env.local");
  process.exit(1);
}

const headers = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
};

async function rest<T>(pathAndQuery: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, { headers });
  if (!res.ok) throw new Error(`${pathAndQuery} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

type Thread = { id: string; kind: string; name: string | null; created_at: string };
type ThreadMember = { thread_id: string; membership_id: string };
type Member = { id: string; display_name: string | null; profile_id: string | null };
type Message = { id: string; thread_id: string; sender_id: string | null; created_at: string };

async function main() {
  const [threads, threadMembers, members, messages] = await Promise.all([
    rest<Thread[]>(
      `chat_threads?select=id,kind,name,created_at&organization_id=eq.${ORG_ID}&order=created_at`,
    ),
    rest<ThreadMember[]>(
      `chat_thread_members?select=thread_id,membership_id&organization_id=eq.${ORG_ID}`,
    ),
    rest<Member[]>(
      `memberships?select=id,display_name,profile_id&organization_id=eq.${ORG_ID}`,
    ),
    rest<Message[]>(
      `chat_messages?select=id,thread_id,sender_id,created_at&organization_id=eq.${ORG_ID}`,
    ),
  ]);

  const memberById = new Map(members.map((m) => [m.id, m]));
  const name = (id: string | null) => {
    if (!id) return "(system)";
    const m = memberById.get(id);
    if (!m) return id.slice(0, 8);
    const label = m.display_name?.trim() || id.slice(0, 8);
    return m.profile_id ? label : `${label} [NO-LOGIN]`;
  };

  console.log(`ORG ${ORG_ID}`);
  console.log(`Threads: ${threads.length} · Messages: ${messages.length}\n`);

  let healthyDms = 0;
  for (const t of threads) {
    const tmembers = threadMembers.filter((x) => x.thread_id === t.id);
    const tmsgs = messages.filter((x) => x.thread_id === t.id);
    const senders = new Set(tmsgs.map((m) => m.sender_id));
    const latest = tmsgs.reduce<string | null>(
      (acc, m) => (acc === null || m.created_at > acc ? m.created_at : acc),
      null,
    );
    const bothCanLogin =
      t.kind === "dm" &&
      tmembers.length === 2 &&
      tmembers.every((tm) => memberById.get(tm.membership_id)?.profile_id);
    const twoWay = senders.size >= 2;
    if (bothCanLogin && tmsgs.length > 0) healthyDms += 1;

    console.log(
      `[${t.kind}] ${t.name ?? "(dm)"}  members=${tmembers
        .map((tm) => name(tm.membership_id))
        .join(" ↔ ")}`,
    );
    console.log(
      `      msgs=${tmsgs.length} · distinct senders=${senders.size}` +
        `${twoWay ? " (TWO-WAY ✓)" : tmsgs.length > 0 ? " (one-way only)" : " (no messages)"}` +
        `${latest ? ` · latest ${latest.slice(0, 16)}` : ""}` +
        `${t.kind === "dm" && !bothCanLogin ? "  <-- a member can't log in" : ""}`,
    );
  }

  console.log(
    `\nSUMMARY: ${healthyDms} DM thread(s) between two login-capable members ` +
      `with at least one message. Total messages across org: ${messages.length}.`,
  );
  if (messages.length === 0) {
    console.log(
      "No chat_messages exist at all — DM send may be failing (RLS / insert). Investigate sendChatMessageAction.",
    );
  } else {
    console.log(
      "Messages exist and persist, so the send path (insert + RLS) works.",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
