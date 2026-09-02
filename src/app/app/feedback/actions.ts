"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getActionContext, parseForm, type ActionState } from "@/lib/actions";
import { notify } from "@/lib/notify";
import {
  FeedbackItemSchema,
  FeedbackReplySchema,
  feedbackKindLabel,
  feedbackStatusLabel,
} from "@/lib/validators/feedback";

type ItemField = keyof typeof FeedbackItemSchema.shape;
export type FeedbackItemFormState = ActionState<ItemField & string>;

type ReplyField = keyof typeof FeedbackReplySchema.shape;
export type FeedbackReplyFormState = ActionState<ReplyField & string>;

/**
 * The three facts that turn "it's broken" into something reproducible, none
 * of which anyone should have to type: where they were, which build was
 * serving, and what they were holding.
 *
 * app_version matches what /api/version reports, so a report filed against a
 * sha that is no longer live can be recognised as possibly-already-fixed
 * instead of chased.
 */
async function captureContext(pageFromForm: string | null) {
  let userAgent: string | null = null;
  try {
    const h = await headers();
    userAgent = h.get("user-agent");
  } catch {
    // headers() can throw outside a request scope; context is a nicety, not
    // a reason to lose the report.
  }
  return {
    page_context: pageFromForm,
    app_version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? "dev",
    user_agent: userAgent,
  };
}

// ---------------------------------------------------------------------------
// File an item
// ---------------------------------------------------------------------------

export async function createFeedbackAction(
  _prev: FeedbackItemFormState,
  formData: FormData,
): Promise<FeedbackItemFormState> {
  const { membership, supabase } = await getActionContext();

  // Passed through as plain strings: the schema's `trimmed` helper turns ""
  // into undefined for the optional fields. Coercing to null here instead
  // would fail validation outright — zod's .optional() does not accept null.
  const raw = {
    kind: String(formData.get("kind") ?? "bug"),
    title: String(formData.get("title") ?? ""),
    body: String(formData.get("body") ?? ""),
    page_context: String(formData.get("page_context") ?? ""),
  };
  const parsed = parseForm(FeedbackItemSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw as never };

  const context = await captureContext(parsed.data.page_context ?? null);

  const { data: inserted, error } = (await supabase
    .from("feedback_items" as never)
    .insert({
      organization_id: membership.organization_id,
      created_by: membership.id,
      kind: parsed.data.kind,
      title: parsed.data.title,
      body: parsed.data.body ?? null,
      // A question filed by the org is already waiting on Sollos, so it
      // starts open like everything else. needs_answer only ever points the
      // other way, and only Sollos sets it.
      status: "open",
      ...context,
    } as never)
    .select("id")
    .single()) as unknown as {
    data: { id: string } | null;
    error: { message: string } | null;
  };

  if (error || !inserted) {
    return {
      errors: { _form: "Could not send that. Please try again." },
      values: raw as never,
    };
  }

  await notify({
    organizationId: membership.organization_id,
    audience: "org-admins",
    excludeMembershipId: membership.id,
    type: "feedback",
    title: `${feedbackKindLabel(parsed.data.kind)}: ${parsed.data.title}`,
    body: parsed.data.body ?? "Opened on the feedback board.",
    href: `/app/feedback/${inserted.id}`,
  });

  revalidatePath("/app/feedback");
  redirect(`/app/feedback/${inserted.id}`);
}

// ---------------------------------------------------------------------------
// Reply (and, in the same act, move the item)
// ---------------------------------------------------------------------------

export async function replyFeedbackAction(
  id: string,
  _prev: FeedbackReplyFormState,
  formData: FormData,
): Promise<FeedbackReplyFormState> {
  const { membership, supabase } = await getActionContext();

  const raw = {
    body: String(formData.get("body") ?? ""),
    status: String(formData.get("status") ?? "") || undefined,
  };
  const parsed = parseForm(FeedbackReplySchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw as never };

  // Read the item through the caller's own client, so RLS decides whether
  // they may touch this thread at all — an employee replying to somebody
  // else's item finds nothing here and stops.
  const { data: item } = (await supabase
    .from("feedback_items" as never)
    .select("id, organization_id, title, status, created_by")
    .eq("id", id)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      organization_id: string;
      title: string;
      status: string;
      created_by: string | null;
    } | null;
  };

  if (!item) {
    return { errors: { _form: "That item no longer exists." } };
  }

  const { error: replyErr } = (await supabase
    .from("feedback_replies" as never)
    .insert({
      feedback_item_id: id,
      organization_id: item.organization_id,
      created_by: membership.id,
      body: parsed.data.body,
    } as never)) as unknown as { error: { message: string } | null };

  if (replyErr) {
    return {
      errors: { _form: "Could not post that reply. Please try again." },
      values: raw as never,
    };
  }

  // The insert above already fired feedback_bump_activity(), which touched
  // last_activity_at and handed a "needs your answer" item back to Sollos.
  // Both live in the trigger rather than here because employees have no
  // update policy on feedback_items — an action-side write would silently
  // skip precisely the replies most easily missed.
  const afterTrigger =
    item.status === "needs_answer" ? "open" : (item.status as string);

  // So the only write left is an explicit choice that disagrees with that —
  // a manager marking something shipped, or asking for one more answer.
  const nextStatus = parsed.data.status ?? afterTrigger;
  if (nextStatus !== afterTrigger) {
    await supabase
      .from("feedback_items" as never)
      .update({ status: nextStatus } as never)
      .eq("id", id);
  }

  const statusChanged = nextStatus !== item.status;
  const bodyLine = statusChanged
    ? `${feedbackStatusLabel(nextStatus)} — ${parsed.data.body}`
    : parsed.data.body;

  if (item.created_by && item.created_by !== membership.id) {
    // Someone answered the reporter.
    await notify({
      organizationId: item.organization_id,
      audience: "membership",
      membershipId: item.created_by,
      type: "feedback",
      title: `Reply: ${item.title}`,
      body: bodyLine,
      href: `/app/feedback/${id}`,
    });
  } else {
    // The reporter followed up on their own thread — tell the other side.
    await notify({
      organizationId: item.organization_id,
      audience: "org-admins",
      excludeMembershipId: membership.id,
      type: "feedback",
      title: `Reply: ${item.title}`,
      body: bodyLine,
      href: `/app/feedback/${id}`,
    });
  }

  revalidatePath("/app/feedback");
  revalidatePath(`/app/feedback/${id}`);
  return {};
}
