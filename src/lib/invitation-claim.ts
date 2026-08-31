import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { assignOnboardingTraining } from "@/lib/onboarding-training";

/**
 * The ONE place an invitation becomes (or re-becomes) a membership.
 *
 * Three different pages accept invites — /join/[token] (the copy-link path),
 * /signup?invite= (new hires from the email), and /join?token= (existing
 * accounts from the email) — and for months each re-implemented the
 * membership write with different fidelity. The copy-link path applied the
 * wage, the engagement, and the onboarding training; the other two, the ones
 * every emailed invite actually goes through, silently dropped some or all
 * of it. A subcontractor hired by email joined as an employee and landed in
 * payroll; the wage typed into the Hire dialog evaporated; the training the
 * help docs promise never assigned.
 *
 * Every accept path now calls this and nothing else. The rules, in order:
 *
 *  1. Already an ACTIVE member → stamp the invite accepted, change nothing.
 *  2. A previous (disabled) membership for this login → re-hire: reactivate
 *     it and the invite's terms (role/engagement/wage) WIN — re-hiring
 *     someone IS setting their terms. History stays on the same row.
 *  3. A SHADOW record with this email (manually added, no login) → link it:
 *     set profile_id on the EXISTING row instead of minting a twin. Their
 *     hours, assignments, and history follow the person to the login — this
 *     kills the duplicate-person factory that once left half a roster
 *     unable to see their own jobs.
 *  4. Otherwise → brand-new membership with the full terms.
 *
 * Onboarding training assigns on every outcome that (re)activates someone;
 * the helper is idempotent so a returning member never gets duplicates.
 */

export type ClaimableInvitation = {
  id: string;
  organization_id: string;
  email: string;
  role: "owner" | "admin" | "manager" | "employee";
  engagement: string | null;
  pay_rate_cents: number | null;
};

export type ClaimOutcome =
  | { ok: true; membershipId: string; alreadyActive: boolean }
  | { ok: false; error: string };

export async function claimInvitation(
  admin: SupabaseClient,
  invitation: ClaimableInvitation,
  userId: string,
): Promise<ClaimOutcome> {
  // The invite's terms. Engagement/wage only when the invite carries them —
  // an absent value must never overwrite what a rehired member already has.
  const terms = {
    role: invitation.role,
    ...(invitation.engagement ? { engagement: invitation.engagement } : {}),
    ...(invitation.pay_rate_cents != null
      ? { pay_rate_cents: invitation.pay_rate_cents }
      : {}),
  };

  const { data: existing } = await admin
    .from("memberships")
    .select("id, status")
    .eq("organization_id", invitation.organization_id)
    .eq("profile_id", userId)
    .maybeSingle();

  if (existing && existing.status === "active") {
    // Deliberately do NOT stamp the invite accepted. An active member can
    // never be the invite's addressee (send-time blocks inviting active
    // emails), so this visitor is holding someone ELSE's link — a signed-in
    // owner testing it, a shared device. Consuming the invite here would
    // hand the real invitee "this link is no longer valid".
    return { ok: true, membershipId: existing.id, alreadyActive: true };
  }

  if (existing) {
    const { error } = await admin
      .from("memberships")
      .update({ status: "active", ...terms } as never)
      .eq("id", existing.id);
    if (error) return { ok: false, error: error.message };
    await assignOnboardingTraining(
      admin,
      invitation.organization_id,
      existing.id,
    );
    await stampAccepted(admin, invitation.id);
    return { ok: true, membershipId: existing.id, alreadyActive: false };
  }

  // Shadow lookup: manual-add lowercases contact_email on save, so an exact
  // lowercase match is the join key. Exactly-one match links; zero or
  // several (ambiguous) fall through to a fresh row rather than guessing.
  const { data: shadows } = (await admin
    .from("memberships")
    .select("id")
    .eq("organization_id", invitation.organization_id)
    .is("profile_id", null)
    .eq("contact_email" as never, invitation.email.toLowerCase() as never)) as unknown as {
    data: Array<{ id: string }> | null;
  };

  if (shadows && shadows.length === 1) {
    const { error } = await admin
      .from("memberships")
      .update({ profile_id: userId, status: "active", ...terms } as never)
      .eq("id", shadows[0].id);
    if (error) return { ok: false, error: error.message };
    await assignOnboardingTraining(
      admin,
      invitation.organization_id,
      shadows[0].id,
    );
    await stampAccepted(admin, invitation.id);
    return { ok: true, membershipId: shadows[0].id, alreadyActive: false };
  }

  const { data: created, error } = await admin
    .from("memberships")
    .insert({
      organization_id: invitation.organization_id,
      profile_id: userId,
      status: "active",
      ...terms,
    } as never)
    .select("id")
    .single();
  if (error || !created) {
    return { ok: false, error: error?.message ?? "Could not join." };
  }
  const membershipId = (created as { id: string }).id;
  await assignOnboardingTraining(
    admin,
    invitation.organization_id,
    membershipId,
  );
  await stampAccepted(admin, invitation.id);
  return { ok: true, membershipId, alreadyActive: false };
}

async function stampAccepted(admin: SupabaseClient, invitationId: string) {
  await admin
    .from("invitations")
    .update({ accepted_at: new Date().toISOString() } as never)
    .eq("id", invitationId);
}
