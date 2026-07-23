import "server-only";
import { randomBytes } from "crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { resolveAutomationEnabled } from "@/lib/automation-defaults";
import { maskEmail } from "@/lib/log-redact";

/**
 * Weekly "what's new in Sollos" email to org owners.
 *
 * This is PLATFORM email (from Sollos to its customers), not tenant email — so
 * it deliberately uses `sendEmail` with the Sollos sender rather than
 * `sendOrgEmail`, which sends on an org's behalf with their branding and is
 * gated by the client-email kill switch.
 *
 * Gating, in order:
 *   1. There must be published, unsent entries — a quiet week sends nothing.
 *      ("Only when big changes are made.")
 *   2. Org master switch on AND product_changelog_email enabled (opt-in, like
 *      every automation).
 *   3. The individual recipient hasn't one-click unsubscribed.
 *
 * This is commercial email under CASL/CAN-SPAM, so every send carries an RFC
 * 8058 one-click List-Unsubscribe pointing at a per-recipient token.
 */

export type ChangelogEntry = {
  id: string;
  title: string;
  body: string;
};

type Recipient = {
  membershipId: string;
  email: string;
  orgName: string;
  unsubToken: string;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Minimal, brand-neutral HTML — matches the tone of the platform emails. */
export function renderChangelogEmail(args: {
  entries: ChangelogEntry[];
  unsubscribeUrl: string;
}): string {
  const items = args.entries
    .map(
      (e) => `
      <tr><td style="padding:0 0 18px 0;">
        <div style="font-size:15px;font-weight:600;color:#111827;">${escapeHtml(e.title)}</div>
        <div style="font-size:14px;line-height:1.6;color:#4b5563;margin-top:4px;">${escapeHtml(e.body)}</div>
      </td></tr>`,
    )
    .join("");

  return `<!doctype html><html><body style="margin:0;padding:0;background:#f9fafb;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:28px;">
        <tr><td style="font-size:18px;font-weight:600;color:#111827;padding-bottom:4px;">What's new in Sollos</td></tr>
        <tr><td style="font-size:13px;color:#6b7280;padding-bottom:20px;">Here's what we shipped recently.</td></tr>
        ${items}
        <tr><td style="border-top:1px solid #e5e7eb;padding-top:16px;font-size:12px;color:#9ca3af;">
          You're getting this because product updates are switched on for your account.
          <a href="${args.unsubscribeUrl}" style="color:#6b7280;">Unsubscribe</a>.
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

/**
 * Send any published-but-unsent changelog entries to opted-in org owners.
 * Idempotent per run: entries are stamped `sent_at` once mailed, so a re-run
 * (or a cron retry) never double-sends.
 */
export async function sendProductChangelog(options?: {
  dryRun?: boolean;
}): Promise<{
  entries: number;
  recipients: number;
  sent: number;
  skipped: number;
}> {
  const db = createSupabaseAdminClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";

  // 1. Anything to say?
  const { data: entryRows } = (await db
    .from("changelog_entries" as never)
    .select("id, title, body")
    .not("published_at", "is", null)
    .is("sent_at", null)
    .order("published_at", { ascending: true })) as unknown as {
    data: ChangelogEntry[] | null;
  };

  const entries = entryRows ?? [];
  if (entries.length === 0) {
    return { entries: 0, recipients: 0, sent: 0, skipped: 0 };
  }

  // 2. Which orgs opted in? (master switch + the per-key toggle)
  const { data: orgRows } = (await db
    .from("organizations")
    .select("id, name, automations_enabled, automation_settings")
    .is("deleted_at", null)) as unknown as {
    data: Array<{
      id: string;
      name: string;
      automations_enabled: boolean | null;
      automation_settings: Record<string, { enabled?: boolean }> | null;
    }> | null;
  };

  const optedInOrgs = new Map<string, string>();
  for (const o of orgRows ?? []) {
    if (o.automations_enabled !== true) continue;
    if (!resolveAutomationEnabled(o.automation_settings, "product_changelog_email"))
      continue;
    optedInOrgs.set(o.id, o.name);
  }
  if (optedInOrgs.size === 0) {
    return { entries: entries.length, recipients: 0, sent: 0, skipped: 0 };
  }

  // 3. Owners of those orgs who haven't personally unsubscribed.
  const { data: memberRows } = (await db
    .from("memberships")
    .select(
      "id, organization_id, role, status, contact_email, profile_id, product_updates_unsubscribed_at, product_updates_unsub_token, profile:profiles ( email )",
    )
    .eq("role", "owner")
    .eq("status", "active")
    .in("organization_id", Array.from(optedInOrgs.keys()))) as unknown as {
    data: Array<{
      id: string;
      organization_id: string;
      contact_email: string | null;
      product_updates_unsubscribed_at: string | null;
      product_updates_unsub_token: string | null;
      profile: { email: string | null } | null;
    }> | null;
  };

  const recipients: Recipient[] = [];
  let skipped = 0;

  for (const m of memberRows ?? []) {
    if (m.product_updates_unsubscribed_at) {
      skipped += 1;
      continue;
    }
    const email = m.contact_email ?? m.profile?.email ?? null;
    if (!email) {
      skipped += 1;
      continue;
    }

    // Mint the one-click unsubscribe token lazily — most members never need one.
    let token = m.product_updates_unsub_token;
    if (!token) {
      token = randomBytes(18).toString("base64url").slice(0, 24);
      const { error } = await db
        .from("memberships")
        .update({ product_updates_unsub_token: token } as never)
        .eq("id", m.id);
      if (error) {
        skipped += 1;
        continue;
      }
    }

    recipients.push({
      membershipId: m.id,
      email,
      orgName: optedInOrgs.get(m.organization_id) ?? "your team",
      unsubToken: token,
    });
  }

  if (options?.dryRun) {
    return {
      entries: entries.length,
      recipients: recipients.length,
      sent: 0,
      skipped,
    };
  }

  let sent = 0;
  for (const r of recipients) {
    const unsubscribeUrl = `${siteUrl}/api/u/p/${r.unsubToken}`;
    try {
      const ok = await sendEmail({
        to: r.email,
        subject: `What's new in Sollos`,
        html: renderChangelogEmail({ entries, unsubscribeUrl }),
        unsubscribeUrl,
      });
      if (ok) sent += 1;
      else skipped += 1;
    } catch (err) {
      skipped += 1;
      console.error(
        `[changelog] send failed for ${maskEmail(r.email)}:`,
        err,
      );
    }
  }

  // 4. Stamp the entries ONLY if at least one email actually went out —
  // otherwise a fully-failed run would silently burn the announcement.
  if (sent > 0) {
    const nowIso = new Date().toISOString();
    await db
      .from("changelog_entries" as never)
      .update({ sent_at: nowIso } as never)
      .in(
        "id",
        entries.map((e) => e.id),
      );
  }

  console.log(
    `[changelog] entries=${entries.length} recipients=${recipients.length} sent=${sent} skipped=${skipped}`,
  );
  return { entries: entries.length, recipients: recipients.length, sent, skipped };
}

/** One-click unsubscribe by token. Shared by the GET + POST routes. */
export async function unsubscribeProductUpdatesByToken(
  token: string,
): Promise<boolean> {
  if (!token || token.length < 8) return false;
  const db = createSupabaseAdminClient();
  const { data, error } = (await db
    .from("memberships")
    .update({ product_updates_unsubscribed_at: new Date().toISOString() } as never)
    .eq("product_updates_unsub_token" as never, token as never)
    .select("id")) as unknown as {
    data: Array<{ id: string }> | null;
    error: { message: string } | null;
  };
  if (error) {
    console.error("[changelog] unsubscribe failed:", error.message);
    return false;
  }
  return (data?.length ?? 0) > 0;
}
