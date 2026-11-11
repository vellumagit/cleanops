/**
 * What an hour is paid at, and what happens when nobody ever said.
 *
 * A shift is priced at the rate frozen on it when it was worked, else the
 * person's current rate. When neither exists the run builders used `?? 0`:
 * the hours went into the run as a $0 line and were stamped as paid, so they
 * could never be paid again (September sweep, Tier 1 #2; on 2026-11-10 Svit's
 * draft run for Oct 16-31 held exactly such a line). An unset rate is not a
 * rate of zero. Hours with no rate are left out of the run, unstamped, and
 * named in its notes; they come back on the next run once a rate is set.
 *
 * A rate someone typed as 0 is still a rate.
 */
export function resolvePayRate(
  snapshotCents: number | null | undefined,
  memberRateCents: number | null | undefined,
): number | null {
  return snapshotCents ?? memberRateCents ?? null;
}

export type Unpriced = Map<string, { name: string; minutes: number; items: number }>;

export function noteUnpriced(into: Unpriced, memberId: string, name: string, minutes: number): void {
  const row = into.get(memberId) ?? { name, minutes: 0, items: 0 };
  row.minutes += minutes;
  row.items += 1;
  into.set(memberId, row);
}

/** "Not included: Anna (2h 00m) and Bea (0h 45m) have no pay rate ..." or null. */
export function unpricedSentence(unpriced: Unpriced): string | null {
  if (unpriced.size === 0) return null;
  const people = [...unpriced.values()]
    .sort((a, b) => b.minutes - a.minutes)
    .map((p) => `${p.name} (${Math.floor(p.minutes / 60)}h ${String(p.minutes % 60).padStart(2, "0")}m)`);
  const list =
    people.length <= 2 ? people.join(" and ") : `${people.slice(0, -1).join(", ")} and ${people[people.length - 1]}`;
  return `Not included: ${list} ${people.length === 1 ? "has" : "have"} no pay rate, so that time is not in this run and is not marked paid. Set a rate and prepare a run again to pay it.`;
}

/**
 * Does this shift still belong in a cleaner's "this period so far"?
 *
 * Preparing a pay run stamps its shifts at once, while it is still a draft
 * the office is reviewing. Her pay page showed unstamped shifts as the
 * running estimate and only finalized runs as statements, so between Prepare
 * and Finalize those hours were on neither list: they simply vanished
 * (Tier 1 #9). A shift in a draft run is still an estimate.
 */
export function stillAnEstimate(
  entry: { payroll_run_id?: string | null; subcontractor_run_id?: string | null },
  draftRunIds: ReadonlySet<string>,
): boolean {
  const run = entry.payroll_run_id ?? entry.subcontractor_run_id ?? null;
  return run === null || draftRunIds.has(run);
}
