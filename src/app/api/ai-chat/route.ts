/**
 * AI assistant chat endpoint.
 *
 * Streams a Claude response back to the floating widget.
 * Only available to orgs in the ENABLED_ORGS allow-list.
 * Every conversation is saved to ai_conversations for UX/bug review.
 */

import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// ─── Feature flag ────────────────────────────────────────────────────────────
// Add org IDs here to enable the AI assistant for them.
const ENABLED_ORGS = new Set([
  "4cf4c402-5889-43c9-91f3-7186f66ee08b", // Svit Company Inc
]);

// ─── System prompt ───────────────────────────────────────────────────────────
const BASE_SYSTEM_PROMPT = `You are Sollos Assistant — a friendly, knowledgeable helper built into Sollos, a cleaning business management platform.

WHAT YOU DO:
1. Answer questions about Sollos features: bookings, recurring series, clients, employees, freelancers, invoices, estimates, scheduling, tasks, calendar, timesheets, checklists, automations, and reports.
2. Help the user understand their live business data using the context snapshot below.
3. FLAG FEEDBACK: When the user says something is confusing, hard to find, slow, broken, or just not working as expected — ALWAYS start your reply with "🚩 Feedback noted:" followed by a one-sentence plain-English summary of the issue, then help them anyway.

HOW TO ANSWER:
- Be concise. Cleaning business owners are busy — get to the point.
- Use numbered steps for anything procedural.
- If you genuinely don't know, say so. Never invent features.
- If something sounds like a real bug (unexpected data, duplicates, things disappearing), say "This sounds like a potential bug — I've flagged it for the Sollos team" and describe what to do in the meantime.

{ORG_CONTEXT}`;

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Auth
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Membership + feature-flag check
  const admin = createSupabaseAdminClient();
  const { data: membership } = (await admin
    .from("memberships")
    .select("id, organization_id, display_name, profile:profiles(full_name)")
    .eq("profile_id", user.id)
    .eq("status", "active")
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      organization_id: string;
      display_name: string | null;
      profile: { full_name: string | null } | null;
    } | null;
  };

  if (!membership || !ENABLED_ORGS.has(membership.organization_id)) {
    return Response.json({ error: "Not available" }, { status: 403 });
  }

  const body = await request.json();
  const messages: { role: "user" | "assistant"; content: string }[] =
    body.messages ?? [];
  const currentPage: string = body.currentPage ?? "unknown";

  if (messages.length === 0) {
    return Response.json({ error: "No messages" }, { status: 400 });
  }

  // Live org context snapshot (lightweight — all count queries)
  const orgId = membership.organization_id;
  const now = new Date().toISOString();
  const weekEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const [bookingsWeek, allClients, unpaidInvoices, openTasks] =
    await Promise.all([
      admin
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("organization_id" as never, orgId)
        .gte("scheduled_at" as never, now)
        .lte("scheduled_at" as never, weekEnd)
        .neq("status" as never, "cancelled"),
      admin
        .from("clients")
        .select("id", { count: "exact", head: true })
        .eq("organization_id" as never, orgId),
      admin
        .from("invoices")
        .select("id", { count: "exact", head: true })
        .eq("organization_id" as never, orgId)
        .in("status" as never, ["sent", "overdue"]),
      Promise.resolve(
        admin
          .from("tasks" as never)
          .select("id", { count: "exact", head: true })
          .eq("organization_id" as never, orgId)
          .is("completed_at" as never, null),
      ).catch(() => ({ count: null })), // tasks table may not exist yet
    ]);

  const userName =
    membership.display_name ?? membership.profile?.full_name ?? "there";

  const orgContext = `LIVE CONTEXT (as of right now):
- User's name: ${userName}
- Current page in the app: ${currentPage}
- Bookings this week (upcoming): ${bookingsWeek.count ?? "N/A"}
- Total clients: ${allClients.count ?? "N/A"}
- Invoices awaiting payment: ${unpaidInvoices.count ?? "N/A"}
- Open tasks: ${(openTasks as { count: number | null }).count ?? "N/A"}`;

  const systemPrompt = BASE_SYSTEM_PROMPT.replace("{ORG_CONTEXT}", orgContext);

  // Stream from Claude
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const encoder = new TextEncoder();
  let fullResponse = "";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const anthropicStream = anthropic.messages.stream({
          model: "claude-3-5-haiku-20241022",
          max_tokens: 1024,
          system: systemPrompt,
          messages,
        });

        for await (const chunk of anthropicStream) {
          if (
            chunk.type === "content_block_delta" &&
            chunk.delta.type === "text_delta"
          ) {
            fullResponse += chunk.delta.text;
            controller.enqueue(encoder.encode(chunk.delta.text));
          }
        }

        controller.close();

        // Save conversation for UX/bug review — fire and forget
        const allMessages = [
          ...messages,
          { role: "assistant", content: fullResponse },
        ];
        Promise.resolve(
          admin
            .from("ai_conversations" as never)
            .insert({
              organization_id: orgId,
              membership_id: membership.id,
              messages: allMessages,
              page_context: currentPage,
            } as never),
        )
          .then(() => {})
          .catch(() => {});
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
