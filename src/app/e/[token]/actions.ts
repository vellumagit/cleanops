"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { enterFailClosed } from "@/lib/supabase/query-guard";
import { checkIpRateLimit } from "@/lib/rate-limit-helpers";

export type RespondToEstimateState = {
  error?: string;
  /** What the estimate now is, once an answer has landed. */
  status?: "approved" | "declined";
};

/**
 * The client's answer to an estimate, from the link they were sent. No
 * sign-in: holding the link is the permission, as it is for reading it.
 *
 * Answered once. The write only lands on an estimate still waiting for an
 * answer, so two taps, or an approve and a decline from two open tabs, leave
 * one answer and one notice to the office. Changing an answer afterwards is
 * the office's job, from the estimate's own page.
 */
export async function respondToEstimateAction(
  _prev: RespondToEstimateState,
  formData: FormData,
): Promise<RespondToEstimateState> {
  enterFailClosed();
  const token = String(formData.get("token") ?? "").trim();
  const decision = String(formData.get("decision") ?? "");
  if (!token || token.length < 8) return { error: "This link isn't valid." };
  if (decision !== "approve" && decision !== "decline") return { error: "Choose Approve or Decline." };

  const rl = await checkIpRateLimit("estimate-respond", 10, 60_000);
  if (!rl.allowed) return { error: "Too many attempts in a short time. Wait a minute and try again." };

  const admin = createSupabaseAdminClient();
  const { data: estimate, error: readErr } = (await admin
    .from("estimates")
    .select("id, organization_id, status, expires_at, sent_at, client:clients ( name ), organization:organizations ( name )")
    .eq("public_token" as never, token as never)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      organization_id: string;
      status: string;
      expires_at: string | null;
      sent_at: string | null;
      client: { name: string | null } | null;
      organization: { name: string | null } | null;
    } | null;
    error: { message: string } | null;
  };
  if (readErr) {
    console.error("[estimate-respond] read failed:", readErr.message);
    return { error: "Couldn't load this estimate. Try the link again in a moment." };
  }
  if (!estimate) return { error: "This estimate could not be found." };

  const sender = estimate.organization?.name ?? "the sender";
  const wanted = decision === "approve" ? "approved" : "declined";
  const already = (status: string): RespondToEstimateState =>
    status === wanted
      ? { status: wanted }
      : { error: `This estimate was already ${status}. To change that, contact ${sender}.` };

  if (estimate.status === "approved" || estimate.status === "declined") return already(estimate.status);
  if (estimate.status === "expired" || (estimate.expires_at && new Date(estimate.expires_at).getTime() < Date.now())) {
    return { error: `This estimate has expired. Contact ${sender} for a new one.` };
  }

  const now = new Date().toISOString();
  const { data: landed, error: writeErr } = (await admin
    .from("estimates")
    .update({ status: wanted, decided_at: now, sent_at: estimate.sent_at ?? now } as never)
    .eq("id", estimate.id)
    .in("status", ["draft", "sent"])
    .select("id")) as unknown as { data: Array<{ id: string }> | null; error: { message: string } | null };
  if (writeErr) {
    console.error("[estimate-respond] write failed:", writeErr.message);
    return { error: `Your answer couldn't be recorded. Try again, or contact ${sender}.` };
  }

  // Another tap or tab answered a moment ago: report what it now is.
  if (!landed?.length) {
    const { data: current } = (await admin
      .from("estimates")
      .select("status")
      .eq("id", estimate.id)
      .maybeSingle()) as unknown as { data: { status: string } | null };
    if (current?.status === "approved" || current?.status === "declined") return already(current.status);
    return { error: `Your answer couldn't be recorded. Contact ${sender}.` };
  }

  const who = estimate.client?.name?.trim() || "The client";
  try {
    const { notify } = await import("@/lib/notify");
    await notify({
      organizationId: estimate.organization_id,
      audience: "org-management",
      topic: "clients",
      title: wanted === "approved" ? "Estimate approved" : "Estimate declined",
      body: `${who} ${wanted} their estimate from the link.`,
      href: `/app/estimates/${estimate.id}/edit`,
    });
  } catch (err) {
    console.error("[estimate-respond] notify failed:", err);
  }

  // The same follow-on as the office marking it approved: the placeholder
  // visit, for companies that switched that automation on.
  if (wanted === "approved") {
    after(async () => {
      const { autoBookingOnEstimateApproval } = await import("@/lib/automations");
      await autoBookingOnEstimateApproval(estimate.id);
    });
  }

  revalidatePath(`/e/${token}`);
  revalidatePath("/app/estimates");
  revalidatePath(`/app/estimates/${estimate.id}/edit`);
  return { status: wanted };
}
