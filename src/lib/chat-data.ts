import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { CurrentMembership } from "@/lib/auth";
import { memberDisplayName } from "@/lib/member-display";

export type ChatThreadSummary = {
  id: string;
  kind: "dm" | "group";
  name: string | null;
  display_name: string;
  other_member_id: string | null;
};

export type ChatMessage = {
  id: string;
  thread_id: string;
  sender_id: string | null;
  sender_name: string | null;
  body: string;
  created_at: string;
};

export type TeammateOption = {
  id: string;
  label: string;
};

/**
 * Returns every chat thread the current member belongs to, with a friendly
 * display name for DMs (the OTHER member's full name).
 */
export async function fetchChatThreads(
  membership: CurrentMembership,
): Promise<ChatThreadSummary[]> {
  const supabase = await createSupabaseServerClient();

  // Step 1: get thread IDs the current member belongs to.
  const { data: myRows, error: myErr } = await supabase
    .from("chat_thread_members")
    .select("thread_id")
    .eq("membership_id", membership.id);

  if (myErr) {
    console.error("[chat] fetchChatThreads step 1 failed:", myErr.message);
    return [];
  }

  const threadIds = (myRows ?? []).map((r) => r.thread_id);
  if (threadIds.length === 0) return [];

  // Step 2: fetch those threads with their members + profile names.
  // This avoids the ambiguous self-referencing join that PostgREST
  // can fail to resolve on certain Supabase versions.
  const { data: threadRows, error: threadErr } = await supabase
    .from("chat_threads")
    .select(
      `
        id,
        kind,
        name,
        created_at,
        members:chat_thread_members (
          membership_id,
          membership:memberships (
            id,
            display_name,
            profile:profiles ( full_name )
          )
        )
      `,
    )
    .in("id", threadIds);

  if (threadErr) {
    console.error("[chat] fetchChatThreads step 2 failed:", threadErr.message);
    return [];
  }

  const threads: ChatThreadSummary[] = [];

  for (const t of threadRows ?? []) {
    let display_name: string;
    let other_member_id: string | null = null;

    if (t.kind === "dm") {
      const otherMember = (t.members ?? []).find(
        (m) => m.membership_id !== membership.id,
      );
      display_name = otherMember?.membership
        ? memberDisplayName(otherMember.membership)
        : "Direct message";
      other_member_id = otherMember?.membership_id ?? null;
    } else {
      display_name = t.name ? `#${t.name}` : "#group";
    }

    threads.push({
      id: t.id,
      kind: t.kind,
      name: t.name,
      display_name,
      other_member_id,
    });
  }

  // Sort: #general first, then DMs alphabetically.
  threads.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "group" ? -1 : 1;
    return a.display_name.localeCompare(b.display_name);
  });

  return threads;
}

/** Recent messages for a single thread, oldest first. */
export async function fetchChatMessages(
  threadId: string,
  limit = 100,
): Promise<ChatMessage[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("chat_messages")
    .select(
      `
        id,
        thread_id,
        sender_id,
        body,
        created_at,
        sender:memberships ( display_name, profile:profiles ( full_name ) )
      `,
    )
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[chat] fetchChatMessages failed:", error.message);
    return [];
  }

  const rows = (data ?? []).map((m) => ({
    id: m.id,
    thread_id: m.thread_id,
    sender_id: m.sender_id,
    sender_name: m.sender ? memberDisplayName(m.sender) : null,
    body: m.body,
    created_at: m.created_at,
  }));

  // Reverse so the UI gets them oldest → newest.
  rows.reverse();
  return rows;
}

/**
 * All other active members of the current org — for the "New DM" picker.
 *
 * Uses the admin client because employees reported an empty picker even
 * when the org had other members. The SELECT policy on memberships
 * *should* let any same-org member see the rest of the team, but RLS
 * edge-cases (profile join visibility, profile_id-null shadow rows
 * failing transitive checks) were stranding the picker. We already
 * scope by `membership.organization_id` (authoritative from
 * requireMembership), so bypassing RLS here is safe and still strictly
 * org-scoped.
 */
export async function fetchTeammates(
  membership: CurrentMembership,
): Promise<TeammateOption[]> {
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .from("memberships")
    .select("id, display_name, profile:profiles ( full_name )")
    .eq("organization_id", membership.organization_id)
    .eq("status", "active")
    .neq("id", membership.id);

  if (error) {
    console.error("[chat] fetchTeammates failed:", error.message);
    return [];
  }

  return (data ?? []).map((m) => ({
    id: m.id,
    label: memberDisplayName(m),
  }));
}
