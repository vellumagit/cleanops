import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What removing a person would take with it.
 *
 * Deleting a membership deleted every shift and bonus that person had: the
 * foreign keys cascaded, while the confirmation told the owner "Bookings and
 * timesheets they appear in will be preserved". Force remove was worse,
 * because its own recipe ("her login is stuck, remove and re-invite") is
 * aimed at someone who has been working. Shifts are what payroll, invoices
 * and job history are computed from, so anyone who has them stays
 * deactivated, exactly as anyone with payroll history already did.
 *
 * Migration 20261110030000 makes the database refuse too. This check runs
 * first because it can say why, and because Force remove deletes the login
 * before the membership: by the time the database refused, the login would
 * already be gone.
 */
export type WorkHistory = { shifts: number; bonuses: number };

/** Throws when it can't read: "couldn't check" must never read as "nothing to lose". */
export async function readWorkHistory(
  admin: SupabaseClient,
  organizationId: string,
  membershipId: string,
): Promise<WorkHistory> {
  const [shifts, bonuses] = await Promise.all([
    admin
      .from("time_entries")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("employee_id", membershipId),
    admin
      .from("bonuses")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("employee_id", membershipId),
  ]);
  const failed = shifts.error ?? bonuses.error;
  if (failed) throw new Error(`could not read work history: ${failed.message}`);
  return { shifts: shifts.count ?? 0, bonuses: bonuses.count ?? 0 };
}

/** Why this person can't be removed, or null when there is nothing to lose. */
export function workHistoryRefusal(
  name: string,
  history: WorkHistory,
  opts: { stuckLogin?: boolean } = {},
): string | null {
  const parts = [
    history.shifts > 0 ? `${history.shifts} recorded shift${history.shifts === 1 ? "" : "s"}` : null,
    history.bonuses > 0 ? `${history.bonuses} bonus${history.bonuses === 1 ? "" : "es"}` : null,
  ].filter((p): p is string => p !== null);
  if (parts.length === 0) return null;
  const base =
    `${name} has ${parts.join(" and ")}. Removing them would delete that history, ` +
    `which payroll, invoices and job records are built from, so they stay deactivated instead.`;
  return opts.stuckLogin
    ? `${base} If their login is stuck, use Generate recovery link on this page.`
    : base;
}
