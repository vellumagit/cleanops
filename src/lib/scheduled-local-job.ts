import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logSystemAuditEvent } from "@/lib/audit";
import { planRederive, type RederiveRow } from "@/lib/scheduled-local";

/**
 * Nightly: re-derive every future visit's instant from its wall clock under
 * this runtime's current zone rules (see scheduled-local.ts). Quiet when the
 * rules haven't changed; when they have, every visit corrects itself with an
 * audit row, and nobody is messaged — the client was told the wall clock,
 * which is what's being restored.
 *
 * After each move the wall clock is read back: the database trigger derives
 * it from the instant when the app doesn't say it, and if Postgres' rules for
 * the zone disagree with this runtime's, the trigger would have rewritten
 * it. The runtime is the authority (it is what refused to run on stale
 * rules), so the typed wall clock is put back and the disagreement logged.
 */
export async function rederiveScheduledInstants(opts: { dryRun?: boolean; now?: number } = {}): Promise<{
  considered: number;
  changed: number;
  refusedZones: string[];
  dbDisagreed: number;
  dryRun: boolean;
}> {
  const db = createSupabaseAdminClient();
  const now = opts.now ?? Date.now();
  const dryRun = opts.dryRun === true;

  const { data, error } = (await db
    .from("bookings")
    .select("id, organization_id, scheduled_at, scheduled_local, scheduled_tz" as never)
    .gte("scheduled_at", new Date(now).toISOString())
    .is("archived_at", null)
    .not("status", "in", "(cancelled,completed)")
    .order("scheduled_at")
    .limit(5000)) as unknown as {
    data: Array<RederiveRow & { organization_id: string }> | null;
    error: { message: string } | null;
  };
  if (error) throw new Error(`rederive: bookings query failed: ${error.message}`);
  const rows = data ?? [];

  const { changes, refusedZones } = planRederive(rows, { now });
  if (refusedZones.length > 0) {
    console.error(
      `[rederive] this runtime's rules are out of date for ${refusedZones.join(", ")} (tzdata ${process.versions.tz ?? "?"}); their visits were left alone`,
    );
  }
  if (dryRun) {
    return { considered: rows.length, changed: changes.length, refusedZones, dbDisagreed: 0, dryRun };
  }

  const orgOf = new Map(rows.map((r) => [r.id, r.organization_id]));
  let changed = 0;
  let dbDisagreed = 0;
  for (const c of changes) {
    // Guard on the instant we read: a visit someone moved in the meantime
    // carries a new wall clock too, and the next night re-plans from that.
    const { data: upd, error: updErr } = (await db
      .from("bookings")
      .update({ scheduled_at: c.to, scheduled_local: c.local, scheduled_tz: c.tz } as never)
      .eq("id", c.id)
      .eq("scheduled_at", c.from)
      .select("scheduled_local" as never)) as unknown as {
      data: Array<{ scheduled_local: string | null }> | null;
      error: { message: string } | null;
    };
    if (updErr) {
      console.error("[rederive] update failed", c.id, updErr.message);
      continue;
    }
    if (!upd || upd.length === 0) continue;
    changed++;
    if ((upd[0].scheduled_local ?? "").slice(0, 16) !== c.local) {
      dbDisagreed++;
      console.error(
        `[rederive] database derived ${upd[0].scheduled_local} for ${c.id}; runtime says ${c.local} in ${c.tz} — Postgres tzdata differs. Restoring the typed wall clock.`,
      );
      await db.from("bookings").update({ scheduled_local: c.local } as never).eq("id", c.id);
    }
    await logSystemAuditEvent({
      organizationId: orgOf.get(c.id) ?? "",
      action: "update",
      entity: "booking",
      entity_id: c.id,
      after: { from: c.from, scheduled_at: c.to, scheduled_local: c.local, scheduled_tz: c.tz, via: "wall_clock_rederive" },
    });
  }
  if (changed > 0) console.log(`[rederive] moved ${changed} visit(s) to match their wall clock`);
  return { considered: rows.length, changed, refusedZones, dbDisagreed, dryRun };
}
