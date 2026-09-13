import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { DISPOSABLE_EMAIL_MESSAGE, isDisposableEmail } from "@/lib/disposable-domains";

/**
 * What a brand-new workspace may do, and what trips the wire.
 *
 * 2026-09-11: a self-serve signup created 35,423 clients with strangers'
 * addresses and mailed them 32,255 times in seven hours. Nothing in the
 * app cost it anything, and nobody was told. This file is the cost and
 * the telling.
 *
 *   week one    no API keys, no Email client, 200 new clients a day
 *   any age     no throwaway addresses on clients or signups
 *   tripwire    past a soft line support gets one email a day with a
 *               one-click suspend; past a hard line the workspace
 *               suspends itself and support hears afterwards
 *
 * Everything here is deliberately cheap: a count or two per call, and it
 * never throws — a broken guard must not stop a real cleaner adding a
 * real client. When in doubt it allows and logs.
 */

export const NEW_ORG_DAYS = 7;
export const NEW_ORG_CLIENTS_PER_DAY = 200;
export const CLIENTS_PER_DAY = 2000;

type OrgFacts = {
  id: string;
  name: string;
  createdAt: string;
  ageDays: number;
  isNew: boolean;
  suspendedAt: string | null;
  abuseFlaggedAt: string | null;
};

async function orgFacts(orgId: string): Promise<OrgFacts | null> {
  const admin = createSupabaseAdminClient();
  const { data } = (await admin
    .from("organizations")
    .select("id, name, created_at, suspended_at, abuse_flagged_at" as never)
    .eq("id", orgId)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      name: string;
      created_at: string;
      suspended_at: string | null;
      abuse_flagged_at: string | null;
    } | null;
  };
  if (!data) return null;
  const ageDays = (Date.now() - new Date(data.created_at).getTime()) / 86_400_000;
  return {
    id: data.id,
    name: data.name,
    createdAt: data.created_at,
    ageDays,
    isNew: ageDays < NEW_ORG_DAYS,
    suspendedAt: data.suspended_at ?? null,
    abuseFlaggedAt: data.abuse_flagged_at ?? null,
  };
}

export type GuardResult = { ok: true } | { ok: false; error: string };

/** Features a workspace under a week old doesn't get. */
export async function guardNewOrgFeature(
  orgId: string,
  feature: "api_keys" | "email_client",
): Promise<GuardResult> {
  try {
    const org = await orgFacts(orgId);
    if (!org) return { ok: true };
    if (org.suspendedAt) return { ok: false, error: SUSPENDED_MESSAGE };
    if (!org.isNew) return { ok: true };
    const daysLeft = Math.max(1, Math.ceil(NEW_ORG_DAYS - org.ageDays));
    return {
      ok: false,
      error:
        feature === "api_keys"
          ? `API keys unlock ${NEW_ORG_DAYS} days after a workspace is created — ${daysLeft} day${daysLeft === 1 ? "" : "s"} to go. Everything else works now.`
          : `Email client unlocks ${NEW_ORG_DAYS} days after a workspace is created — ${daysLeft} day${daysLeft === 1 ? "" : "s"} to go. Invoices and estimates can be sent from their own pages today.`,
    };
  } catch (err) {
    console.error("[abuse-guard] feature guard threw, allowing:", err);
    return { ok: true };
  }
}

/**
 * Before a client is created, from any door: the form, the API, a
 * website intake form. Refuses throwaway addresses and a runaway rate.
 */
export async function guardClientCreate(
  orgId: string,
  email: string | null | undefined,
): Promise<GuardResult> {
  try {
    if (email && isDisposableEmail(email)) {
      return { ok: false, error: DISPOSABLE_EMAIL_MESSAGE };
    }
    const org = await orgFacts(orgId);
    if (!org) return { ok: true };
    if (org.suspendedAt) return { ok: false, error: SUSPENDED_MESSAGE };
    const admin = createSupabaseAdminClient();
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const { count } = (await admin
      .from("clients")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .gte("created_at", since)) as unknown as { count: number | null };
    const cap = org.isNew ? NEW_ORG_CLIENTS_PER_DAY : CLIENTS_PER_DAY;
    if ((count ?? 0) >= cap) {
      // Past the line is the tripwire's business; this call just refuses.
      void evaluateAbuse(orgId).catch(() => {});
      return {
        ok: false,
        error: `This workspace has added ${cap} clients in the last day, which is its limit. If you're importing a real client list, ask Sollos support and we'll lift it.`,
      };
    }
    return { ok: true };
  } catch (err) {
    console.error("[abuse-guard] client guard threw, allowing:", err);
    return { ok: true };
  }
}

export const SUSPENDED_MESSAGE =
  "This workspace is suspended. Contact support@sollos3.com.";

// ---------------------------------------------------------------------------
// The tripwire
// ---------------------------------------------------------------------------

export type AbuseSignals = {
  ageDays: number;
  isNew: boolean;
  clientsToday: number;
  disposableClientsToday: number;
  emailsToday: number;
};

export type AbuseVerdict = { level: "none" | "soft" | "hard"; reasons: string[] };

/** Pure: what the numbers say. Tested on its own. */
export function judgeAbuse(s: AbuseSignals): AbuseVerdict {
  const reasons: string[] = [];
  let level: AbuseVerdict["level"] = "none";
  const bump = (to: "soft" | "hard", why: string) => {
    reasons.push(why);
    if (to === "hard" || level === "none") level = to;
  };
  const disposableShare = s.clientsToday >= 10 ? s.disposableClientsToday / s.clientsToday : 0;
  if (s.isNew) {
    if (s.clientsToday >= 500) bump("hard", `${s.clientsToday} clients created in a day, in week one`);
    else if (s.clientsToday >= 100) bump("soft", `${s.clientsToday} clients created in a day, in week one`);
    if (s.emailsToday >= 50) bump("hard", `${s.emailsToday} emails in a day, in week one (the cap)`);
    else if (s.emailsToday >= 20) bump("soft", `${s.emailsToday} emails in a day, in week one`);
    if (disposableShare >= 0.5 && s.clientsToday >= 50) bump("hard", `${Math.round(disposableShare * 100)}% of today's clients use throwaway inboxes`);
    else if (disposableShare >= 0.5) bump("soft", `${Math.round(disposableShare * 100)}% of today's clients use throwaway inboxes`);
  } else {
    if (s.clientsToday >= 1000) bump("soft", `${s.clientsToday} clients created in a day`);
    if (s.emailsToday >= 500) bump("soft", `${s.emailsToday} emails in a day (the cap)`);
    if (disposableShare >= 0.5 && s.clientsToday >= 50) bump("soft", `${Math.round(disposableShare * 100)}% of today's clients use throwaway inboxes`);
  }
  return { level, reasons };
}

function suspendSignature(orgId: string): string | null {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return null;
  return createHmac("sha256", secret).update(`suspend:${orgId}`).digest("hex");
}

/** Verify a signed suspend/unsuspend link. Constant-time. */
export function verifySuspendSignature(orgId: string, sig: string | null): boolean {
  const expected = suspendSignature(orgId);
  if (!expected || !sig || sig.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

export async function suspendOrg(orgId: string, reason: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin
    .from("organizations")
    .update({ suspended_at: new Date().toISOString(), suspend_reason: reason.slice(0, 500) } as never)
    .eq("id", orgId);
  // Close the API too: every key the workspace has.
  await admin
    .from("api_keys" as never)
    .update({ revoked_at: new Date().toISOString() } as never)
    .eq("organization_id" as never, orgId as never)
    .is("revoked_at" as never, null as never);
}

export async function unsuspendOrg(orgId: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin
    .from("organizations")
    .update({ suspended_at: null, suspend_reason: null } as never)
    .eq("id", orgId);
}

/**
 * Look at the last 24 hours for this workspace and act. Called after a
 * client is created and after an org email is sent; cheap enough for that.
 * Soft: one email to support a day, with suspend link. Hard: suspend now,
 * then tell support.
 */
export async function evaluateAbuse(orgId: string): Promise<AbuseVerdict> {
  const none: AbuseVerdict = { level: "none", reasons: [] };
  try {
    const org = await orgFacts(orgId);
    if (!org || org.suspendedAt) return none;
    const admin = createSupabaseAdminClient();
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const day = new Date().toISOString().slice(0, 10);
    const [{ data: recent }, { data: counter }] = await Promise.all([
      admin
        .from("clients")
        .select("email")
        .eq("organization_id", orgId)
        .gte("created_at", since)
        .limit(5000) as unknown as Promise<{ data: Array<{ email: string | null }> | null }>,
      admin
        .from("org_email_counters" as never)
        .select("sent")
        .eq("organization_id" as never, orgId as never)
        .eq("day" as never, day as never)
        .maybeSingle() as unknown as Promise<{ data: { sent: number } | null }>,
    ]);
    const clientsToday = recent?.length ?? 0;
    const disposableClientsToday = (recent ?? []).filter((c) => isDisposableEmail(c.email)).length;
    const signals: AbuseSignals = {
      ageDays: org.ageDays,
      isNew: org.isNew,
      clientsToday,
      disposableClientsToday,
      emailsToday: counter?.sent ?? 0,
    };
    const verdict = judgeAbuse(signals);
    if (verdict.level === "none") return verdict;

    const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
    const sig = suspendSignature(orgId);
    const suspendUrl = sig ? `${site}/api/admin/suspend-org?org=${orgId}&sig=${sig}` : null;
    const unsuspendUrl = sig ? `${site}/api/admin/suspend-org?org=${orgId}&sig=${sig}&undo=1` : null;
    const { emailSupport } = await import("@/lib/support-mail");

    if (verdict.level === "hard") {
      await suspendOrg(orgId, `Automatic: ${verdict.reasons.join("; ")}`);
      await emailSupport({
        subject: `[Abuse] Suspended "${org.name}" — ${verdict.reasons[0]}`,
        fields: [
          ["Workspace", `${org.name} (${orgId})`],
          ["Age", `${org.ageDays.toFixed(1)} days`],
          ["Clients today", String(clientsToday)],
          ["Throwaway inboxes today", String(disposableClientsToday)],
          ["Emails today", String(signals.emailsToday)],
          ["Action", "Suspended automatically; sign-in, sending and the API are closed."],
        ],
        message: verdict.reasons.join("\n"),
        href: unsuspendUrl ?? undefined,
      });
      console.warn(`[abuse-guard] suspended org ${orgId}: ${verdict.reasons.join("; ")}`);
      return verdict;
    }

    // Soft: at most one email a day.
    const flaggedMs = org.abuseFlaggedAt ? new Date(org.abuseFlaggedAt).getTime() : 0;
    if (Date.now() - flaggedMs < 86_400_000) return verdict;
    await admin
      .from("organizations")
      .update({ abuse_flagged_at: new Date().toISOString() } as never)
      .eq("id", orgId);
    await emailSupport({
      subject: `[Abuse?] "${org.name}" — ${verdict.reasons[0]}`,
      fields: [
        ["Workspace", `${org.name} (${orgId})`],
        ["Age", `${org.ageDays.toFixed(1)} days`],
        ["Clients today", String(clientsToday)],
        ["Throwaway inboxes today", String(disposableClientsToday)],
        ["Emails today", String(signals.emailsToday)],
        ["Suspend", suspendUrl],
      ],
      message: `${verdict.reasons.join("\n")}\n\nNothing has been blocked yet. The link above opens a page with a Suspend button (a click, never a preview); the same link with &undo=1 lifts it.`,
      href: `${site}/app`,
    });
    return verdict;
  } catch (err) {
    console.error("[abuse-guard] evaluateAbuse threw:", err);
    return none;
  }
}
