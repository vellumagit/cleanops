import type { SupabaseClient } from "@supabase/supabase-js";
import { zonedDayStartUtc, zonedMidnightUtc } from "@/lib/wall-clock";
import { memberDisplayName } from "@/lib/member-display";

/**
 * People with hours in a pay period and no rate to price them at.
 *
 * Both pay runs floor a missing rate at $0 and stamp the hours as settled, so
 * setting the rate afterwards changes nothing: the statement has to be deleted
 * and prepared again. Nothing said so. Oct 16-31, 2026: Iryna Ilin and Alona
 * Smirnova had 19.2 hours, including the Oliver Little job, and no rate.
 *
 * It warns rather than blocks, because someone on a salary legitimately has no
 * hourly rate, and one such person shouldn't hold everyone else's pay. Owners
 * are left out entirely: they clock in on jobs and usually aren't hourly, so
 * including them would make this a warning people learn to ignore.
 */

export type RateGapEntry = {
  employee_id: string | null;
  clock_in_at: string | null;
  clock_out_at: string | null;
  pay_rate_cents_snapshot: number | null;
};

export type RateGapMember = {
  name: string;
  role: string;
  payRateCents: number | null;
};

export type RateGap = { membershipId: string; name: string; minutes: number };

export function findRateGaps(
  entries: readonly RateGapEntry[],
  members: ReadonlyMap<string, RateGapMember>,
): RateGap[] {
  const out = new Map<string, RateGap>();
  for (const e of entries) {
    if (!e.employee_id || !e.clock_in_at || !e.clock_out_at) continue;
    const member = members.get(e.employee_id);
    if (!member || member.role === "owner") continue;
    // Same precedence that prices the shift: snapshot, then current rate.
    if (e.pay_rate_cents_snapshot || member.payRateCents) continue;
    const minutes = Math.round(
      (new Date(e.clock_out_at).getTime() - new Date(e.clock_in_at).getTime()) / 60_000,
    );
    if (minutes <= 0) continue;
    const gap = out.get(e.employee_id) ?? {
      membershipId: e.employee_id,
      name: member.name,
      minutes: 0,
    };
    gap.minutes += minutes;
    out.set(e.employee_id, gap);
  }
  return [...out.values()].sort((a, b) => b.minutes - a.minutes);
}

function who(gaps: readonly RateGap[]): string {
  const names = gaps.map((g) => `${g.name} (${(g.minutes / 60).toFixed(1)}h)`);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The warning, in the words that fit where the period stands. Before it's
 * prepared, setting a rate is all it takes; after, the $0 is already stamped.
 */
export function describeRateGaps(
  gaps: readonly RateGap[],
  stage: "before_prepare" | "prepared",
): string | null {
  if (gaps.length === 0) return null;
  const one = gaps.length === 1;
  return stage === "before_prepare"
    ? `${who(gaps)} ${one ? "has" : "have"} hours but no pay rate. Set ${one ? "it" : "their rates"} on the employee file before this period is prepared, or those hours are paid at $0.`
    : `${who(gaps)} ${one ? "has" : "have"} hours but no pay rate, so they are on this period at $0. To fix it: set the rate on the employee file, delete the statement or run, and prepare the period again.`;
}

/** The gaps in one pay period (org-local days, the same window the runs use). */
export async function loadRateGaps(
  db: SupabaseClient,
  organizationId: string,
  periodStart: string,
  periodEnd: string,
  tz: string,
): Promise<RateGap[]> {
  const fromIso = zonedMidnightUtc(periodStart, tz).toISOString();
  const toIso = zonedDayStartUtc(zonedMidnightUtc(periodEnd, tz), tz, 1).toISOString();
  const { data: entries, error } = (await db
    .from("time_entries")
    .select("employee_id, clock_in_at, clock_out_at, pay_rate_cents_snapshot")
    .eq("organization_id", organizationId)
    .not("clock_out_at", "is", null)
    .gte("clock_in_at", fromIso)
    .lt("clock_in_at", toIso)
    .limit(1000)) as unknown as {
    data: RateGapEntry[] | null;
    error: { message: string } | null;
  };
  if (error) throw new Error(`rate gaps: ${error.message}`);
  const ids = [
    ...new Set(
      (entries ?? [])
        .filter((e) => !e.pay_rate_cents_snapshot)
        .map((e) => e.employee_id)
        .filter((id): id is string => !!id),
    ),
  ];
  if (ids.length === 0) return [];

  const { data: rows, error: memberErr } = (await db
    .from("memberships")
    .select("id, role, pay_rate_cents, display_name, profile:profiles ( full_name )")
    .eq("organization_id", organizationId)
    .in("id", ids)) as unknown as {
    data: Array<{
      id: string;
      role: string;
      pay_rate_cents: number | null;
      display_name: string | null;
      profile: { full_name: string | null } | null;
    }> | null;
    error: { message: string } | null;
  };
  if (memberErr) throw new Error(`rate gaps: ${memberErr.message}`);
  const members = new Map<string, RateGapMember>(
    (rows ?? []).map((m) => [
      m.id,
      { name: memberDisplayName(m), role: m.role, payRateCents: m.pay_rate_cents },
    ]),
  );
  return findRateGaps(entries ?? [], members);
}
