/**
 * AI assistant chat endpoint.
 *
 * Streams a Claude response back to the floating widget.
 * Available to every org — gated only by an active membership and the
 * presence of ANTHROPIC_API_KEY.
 * Every conversation is saved to ai_conversations for UX/bug review.
 */

import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { HELP_ARTICLES } from "@/content/help";

// The assistant reads the SAME help library the in-app Help section renders
// (src/content/help). Brian caught it telling a user there was no Help
// section minutes after one shipped — a hand-written prompt goes stale the
// moment the app moves. Articles travel in the same commit as the features
// they describe, so building the prompt from them at request time means
// every deploy re-teaches the assistant automatically. No update chore, no
// interval, no drift.
const HELP_LIBRARY = HELP_ARTICLES.map(
  (a) => `### ${a.title} — in the app at /app/help/${a.slug}\n${a.body.trim()}`,
).join("\n\n");

// ─── System prompt ───────────────────────────────────────────────────────────
const BASE_SYSTEM_PROMPT = `You are Sollos Assistant — a friendly, knowledgeable helper built into Sollos, a cleaning business management platform.

WHAT YOU DO:
1. Answer questions about Sollos features: bookings, recurring series, clients, employees, subcontractors, invoices, estimates, scheduling, tasks, calendar, timesheets, checklists, automations, and reports.
2. Help the user understand their live business data using the context snapshot below.
3. FLAG FEEDBACK: When the user says something is confusing, hard to find, slow, broken, or just not working as expected — ALWAYS start your reply with "🚩 Feedback noted:" followed by a one-sentence plain-English summary of the issue, then help them anyway. "Noted" means noted HERE, in this conversation, which is saved for review. It does NOT mean a person has been told. If it matters enough to need an answer, say so and point them at the Report a problem button below the message box (or Feedback in the sidebar) — that one reaches the team and gives them a thread they can follow.
4. POINT TO HELP: Sollos has a built-in Help section — the "Help" entry at the bottom of the sidebar, or /app/help. The full text of every guide is in the HELP LIBRARY below; answer from it, and when a guide covers the topic, end with a pointer like "Full guide: Help → Checklists." Never say Sollos has no help section.

HOW TO ANSWER:
- Be concise. Cleaning business owners are busy — get to the point.
- Use numbered steps for anything procedural.
- If you genuinely don't know, say so. Never invent features.
- If something sounds like a real bug (unexpected data, duplicates, things disappearing), say "This sounds like a real bug — please send it with the Report a problem button just below, so it gets a thread and someone answers you" and describe what to do in the meantime. NEVER claim you have already reported, flagged, escalated, or sent anything to a person: you cannot, and for months this assistant told users their bugs had been passed on when nothing was reading them.

AUTOMATIONS — LOAD-BEARING FACTS (full detail is in the HELP LIBRARY's
Automations guide; answer from there and never contradict these):
- Sollos has a FIXED set of built-in automations with on/off toggles. There is
  NO custom automation builder: users cannot create automations, define
  triggers, chain actions, or edit email templates. If asked how to "create an
  automation," explain they choose from the built-in list instead.
- Everything is OFF by default; the master switch must be on. Presets only
  ever turn things ON.
- Invoice AUTO-SEND is configured in Settings → Invoicing, not Automations.
- Every client message passes the full chain: org toggle → house default →
  the client's own notification setting → (for texts) SMS double opt-in.
  Texts never send without opt-in; STOP always wins.

STRICT RULE: if a question is about a feature or screen not described above,
in the HELP LIBRARY, or visible in the context snapshot, do NOT guess at steps
or invent UI. Say you're not certain how that part works and flag it with
"🚩 Feedback noted:" so the team can improve the docs.

HELP LIBRARY (the app's own guides — same content as /app/help, always
current because it ships with each deploy):

{HELP_LIBRARY}`;

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
    .select(
      "id, organization_id, role, capabilities, display_name, profile:profiles(full_name)",
    )
    .eq("profile_id", user.id)
    .eq("status", "active")
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      organization_id: string;
      role: string;
      capabilities: unknown;
      display_name: string | null;
      profile: { full_name: string | null } | null;
    } | null;
  };

  if (!membership) {
    return Response.json({ error: "Not available" }, { status: 403 });
  }

  // The assistant needs a configured Anthropic key. Fail soft with a
  // friendly message instead of a stream that errors mid-flight.
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "The assistant isn't available right now. Please try again later." },
      { status: 503 },
    );
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
  // The assistant's context is a surface like any page: a manager with
  // invoicing switched off doesn't get invoice counts whispered to them here.
  const { hasCapability, parseCapabilities } = await import("@/lib/capabilities");
  const canSeeMoney = hasCapability(
    membership.role as "owner" | "admin" | "manager" | "employee",
    parseCapabilities(membership.capabilities),
    "invoicing",
  );
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
${canSeeMoney ? `- Invoices awaiting payment: ${unpaidInvoices.count ?? "N/A"}` : ""}
- Open tasks: ${(openTasks as { count: number | null }).count ?? "N/A"}`;

  // Two system blocks: the big static one (base prompt + help library) is
  // identical for every request, so it's marked cacheable — Anthropic bills
  // cache reads at a tenth of input. The per-request org snapshot rides
  // separately so it never busts that cache.
  const staticSystem = BASE_SYSTEM_PROMPT.replace(
    "{HELP_LIBRARY}",
    HELP_LIBRARY,
  );

  // Stream from Claude
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const encoder = new TextEncoder();
  let fullResponse = "";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const anthropicStream = anthropic.messages.stream({
          // Current fast/cheap Haiku. The old claude-3-5-haiku-20241022 was
          // retired by Anthropic, which made every assistant request error.
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1024,
          system: [
            {
              type: "text",
              text: staticSystem,
              cache_control: { type: "ephemeral" },
            },
            { type: "text", text: orgContext },
          ],
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

        // A "🚩 Feedback noted" is the assistant hearing a complaint on the
        // product's behalf. It was saved to ai_conversations — a table nobody
        // reads — and went no further. Forward it to support with the user's
        // words, so the flag means something.
        if (fullResponse.startsWith("🚩 Feedback noted:")) {
          const lastUser = [...messages].reverse().find((m) => m.role === "user");
          const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
          void import("@/lib/support-mail").then(({ emailSupport }) =>
            emailSupport({
              subject: `[Assistant flag] ${fullResponse.split("\n")[0].slice(0, 120)}`,
              replyTo: user.email ?? null,
              fields: [
                ["From", user.email ?? null],
                ["Org", orgId],
                ["Page", currentPage],
              ],
              message: lastUser
                ? `They said:\n${lastUser.content}\n\nAssistant replied:\n${fullResponse}`
                : fullResponse,
              href: `${site}${currentPage.startsWith("/") ? currentPage : "/app"}`,
            }),
          );
        }

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
