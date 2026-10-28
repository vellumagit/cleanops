import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { collectNeedsYou } from "@/lib/needs-you";
import { notify } from "@/lib/notify";

/**
 * The "Needs you" list, pushed. Managers are rarely at a desk, so an item
 * that can't wait (a no-show decision, someone who hasn't clocked in) goes
 * to their phones the first time it appears — once, keyed by the item, so
 * the 30-minute heartbeat never repeats itself.
 *
 * Plus the night-before check: at 6 PM in the org's zone, one message
 * listing tomorrow's problems while there's still time to fix them.
 */

/** Local hour at which the night-before digest goes out. */
export const NIGHT_BEFORE_HOUR = 18;

export async function sendNeedsYouAlerts(opts: { now?: number } = {}): Promise<{
  orgs: number;
  alerted: number;
  digests: number;
}> {
  const db = createSupabaseAdminClient();
  const now = opts.now ?? Date.now();
  let alerted = 0;
  let digests = 0;

  const { data: orgs } = (await db
    .from("organizations")
    .select("id, timezone")
    .is("deleted_at", null)) as unknown as {
    data: Array<{ id: string; timezone: string | null }> | null;
  };

  for (const org of orgs ?? []) {
    try {
      const { items, tz } = await collectNeedsYou(org.id, { now });
      const urgent = items.filter((it) => it.alert);
      const tomorrow = items.filter((it) => it.kind === "tomorrow");
      const tomorrowYmd = new Date(now + 24 * 3_600_000).toLocaleDateString("en-CA", { timeZone: tz });
      const digestKey = `night_before:${tomorrowYmd}`;
      const localHour = Number(
        new Date(now).toLocaleString("en-US", { timeZone: tz, hour: "numeric", hour12: false }),
      );

      const keys = [
        ...urgent.map((it) => it.key),
        ...urgent.flatMap((it) => it.tell?.unlessSent ?? []),
        digestKey,
      ];
      const { data: sent } = (await db
        .from("needs_you_state" as never)
        .select("key, notified_at")
        .eq("organization_id" as never, org.id as never)
        .in("key" as never, keys as never)) as unknown as {
        data: Array<{ key: string; notified_at: string | null }> | null;
      };
      // A mark counts only if it was made about the job's current schedule.
      // Nothing clears these on a reschedule, so a job moved after its
      // alert went out would otherwise never alert again.
      const sinceOf = new Map<string, number>();
      for (const it of urgent) {
        if (it.sinceMs == null) continue;
        sinceOf.set(it.key, it.sinceMs);
        for (const k of it.tell?.unlessSent ?? []) sinceOf.set(k, it.sinceMs);
      }
      const already = new Set(
        (sent ?? [])
          .filter((r) => r.notified_at && new Date(r.notified_at).getTime() >= (sinceOf.get(r.key) ?? 0))
          .map((r) => r.key),
      );

      for (const it of urgent) {
        if (already.has(it.key)) continue;
        // Mark first, then send. The other order repeats the same email
        // every 30 minutes if the mark fails; this order loses at most one
        // alert if the send fails, which is notify's best-effort contract
        // anyway.
        if (!(await markNotified(org.id, it.key, now))) continue;
        const body = (it.body ?? "").trim();
        await notify({
          audience: "org-management",
          organizationId: org.id,
          type: "general",
          title: it.title,
          body: `${body}${body && !/[.!?]$/.test(body) ? "." : ""} Answer it on your dashboard.`.trim(),
          href: "/app",
          // Email too. Push only reaches a phone that has allowed it, and
          // on 2026-10-28 the one manager who runs the day had never
          // allowed it — so a push-only alert was an in-app badge she'd see
          // whenever she next opened the app. These fire once per item, so
          // the mailbox cost is one message per real problem.
          channels: { email: true },
        });
        if (it.tell && !(it.tell.unlessSent ?? []).some((k) => already.has(k))) {
          await notify({
            audience: "membership",
            membershipId: it.tell.membershipId,
            organizationId: org.id,
            type: "general",
            title: it.tell.title,
            body: it.tell.body,
            href: it.tell.href,
          });
        }
        alerted++;
      }

      if (
        localHour === NIGHT_BEFORE_HOUR &&
        !already.has(digestKey) &&
        (await markNotified(org.id, digestKey, now))
      ) {
        if (tomorrow.length > 0) {
          const lines = tomorrow.slice(0, 6).map((it) => `${it.title.replace(/^Tomorrow /, "")} — ${it.body}`);
          if (tomorrow.length > 6) lines.push(`and ${tomorrow.length - 6} more`);
          await notify({
            audience: "org-management",
            organizationId: org.id,
            type: "general",
            title:
              tomorrow.length === 1
                ? "Tomorrow: 1 job needs a look"
                : `Tomorrow: ${tomorrow.length} jobs need a look`,
            body: lines.join("\n"),
            href: "/app",
            channels: { email: true },
          });
          digests++;
        }
      }
    } catch (err) {
      console.error("[needs-you] alerts failed for org", org.id, err);
    }
  }
  return { orgs: orgs?.length ?? 0, alerted, digests };
}

/** True when the mark stuck. A false means: don't send, try next heartbeat. */
async function markNotified(organizationId: string, key: string, now: number): Promise<boolean> {
  const db = createSupabaseAdminClient();
  const { error } = (await (db.from("needs_you_state" as never).upsert(
    { organization_id: organizationId, key, notified_at: new Date(now).toISOString() } as never,
    { onConflict: "organization_id,key" } as never,
  ) as unknown as Promise<{ error: { message: string } | null }>));
  if (error) {
    console.error("[needs-you] could not mark alert sent", { organizationId, key, error: error.message });
    return false;
  }
  return true;
}
