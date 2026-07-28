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

// ─── System prompt ───────────────────────────────────────────────────────────
const BASE_SYSTEM_PROMPT = `You are Sollos Assistant — a friendly, knowledgeable helper built into Sollos, a cleaning business management platform.

WHAT YOU DO:
1. Answer questions about Sollos features: bookings, recurring series, clients, employees, subcontractors, invoices, estimates, scheduling, tasks, calendar, timesheets, checklists, automations, and reports.
2. Help the user understand their live business data using the context snapshot below.
3. FLAG FEEDBACK: When the user says something is confusing, hard to find, slow, broken, or just not working as expected — ALWAYS start your reply with "🚩 Feedback noted:" followed by a one-sentence plain-English summary of the issue, then help them anyway.

HOW TO ANSWER:
- Be concise. Cleaning business owners are busy — get to the point.
- Use numbered steps for anything procedural.
- If you genuinely don't know, say so. Never invent features.
- If something sounds like a real bug (unexpected data, duplicates, things disappearing), say "This sounds like a potential bug — I've flagged it for the Sollos team" and describe what to do in the meantime.

HOW AUTOMATIONS ACTUALLY WORK (verified against the codebase — do not describe
them any other way):
- Sollos has a FIXED set of built-in automations with on/off toggles. There is
  NO custom automation builder: users cannot create automations, define
  triggers, chain actions, or edit email templates. If asked how to "create an
  automation," explain they choose from the built-in list instead.
- Settings → Automations is organized by the life of a job: Winning the work
  (estimate follow-ups, stale-estimate alert, draft-booking-on-approval,
  auto-expire), When a job is booked (confirmations, reschedule/cancel notices
  by email or text, crew assignment push/text, unassigned alert), The day
  before (24h client reminder email/text), Job done & getting paid
  (auto-complete, auto-draft invoice, recurring invoices, overdue reminders,
  receipt on payment, auto-void), Growing the business (review requests,
  Google review asks, rebooking nudges), and Team & back office (crew
  schedules, digests, payroll/PTO/training emails, housekeeping). Each stage
  expands to show its toggles with an on-count.
- Everything is OFF by default. A master switch at the top must be on for
  anything to run — turning it off also stops invoice auto-send emails.
  One-click presets ("The essentials" = 8 core automations, "Full service" =
  19) turn on a sensible bundle; individual toggles fine-tune. Presets only
  ever turn things ON.
- TWO FLOWS (Settings → Automations is organized as two permanent sections;
  there is no mode switch): "Client automations" — every message a client can
  receive, in journey order; and "Internal automations" — team alerts and
  background bookkeeping that never reach a client. For client messages the
  rule is always the same: the org toggle turns the message type on, then the
  house default ("Default client notifications": email / text / both / none)
  plus each client's own settings decide who actually receives it. An org
  that wants nothing sent to unconfigured clients sets the house default to
  "No notifications" and manages clients one by one in the per-client
  manager (also linked from each client's profile).
- Client messages then pass two more gates: the client's own notification
  setting (follow the org default, custom per category — booking / billing /
  reviews — or do-not-contact), and for texts, the client's SMS opt-in
  (double opt-in; STOP always wins). Texts never send without opt-in.
- Invoice AUTO-SEND lives in Settings → Invoicing, not Automations. When on,
  a drafted invoice sends itself at the org's chosen local time (default
  5:00 PM) on the DAY AFTER the job — a predictable clock time, not a rolling
  delay. Delivery follows the client's billing channel: email, or a text
  carrying the hosted view-and-pay link for clients set to text (requires
  their SMS opt-in and the org's SMS being enabled), or both. Overdue
  reminders and payment receipts likewise go by email and/or text; review
  asks and rebooking nudges remain email-only. Every draft has Hold / Send-now escape hatches. The companion
  "Morning invoice review digest" toggle (Settings → Automations, "Job done &
  getting paid" stage) emails owners/admins each morning with yesterday's
  jobs and the invoices going out later that day, so they can fix or hold
  anything first. Consolidated biweekly/monthly billing is driven by each
  client's billing cadence on their client record.
- Settings → Thresholds controls the housekeeping timers (auto-expire,
  auto-void, auto-complete, auto-archive). Leaving a field blank disables that
  timer for the org.
- Marketing-style emails (rebooking nudges, Google review asks) carry their
  own one-click unsubscribe for the client; unsubscribing stops only those,
  never booking confirmations or invoices.
- Sending an estimate or invoice by hand is NOT an automation — the Send
  buttons always work regardless of automation settings. Same for the bench
  shift-offer texts and SMS opt-in requests: owner-clicked, always allowed.

STRICT RULE: if a question is about a feature or screen not described above or
visible in the context snapshot, do NOT guess at steps or invent UI. Say you're
not certain how that part works and flag it with "🚩 Feedback noted:" so the
team can improve the docs.

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
          // Current fast/cheap Haiku. The old claude-3-5-haiku-20241022 was
          // retired by Anthropic, which made every assistant request error.
          model: "claude-haiku-4-5-20251001",
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
