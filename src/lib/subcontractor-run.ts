/**
 * Grouping and pricing for a subcontractor pay run — the pure middle of the
 * generator, extracted so the money math is testable without a database.
 *
 * Pricing MUST match payroll and the payables screens exactly:
 *
 *   booking.hourly_rate_cents  ->  pay_rate_cents_snapshot  ->  member rate
 *
 * "The same shift must not be worth two different amounts depending on which
 * screen you open" (subcontractor-payables.ts) — and a statement is the
 * screen that ends up in someone's records, so it least of all.
 */

export type RunnableEntry = {
  id: string;
  employee_id: string | null;
  clock_in_at: string | null;
  clock_out_at: string | null;
  pay_rate_cents_snapshot: number | null;
  booking: { hourly_rate_cents: number | null } | null;
};

export type RunItemDraft = {
  membershipId: string;
  minutes: number;
  entryCount: number;
  totalCents: number;
  /** Every entry consumed by this item — the ids that get stamped. */
  entryIds: string[];
};

/**
 * Group priceable entries per subcontractor.
 *
 * A payee whose window contains only zero-minute entries gets NO item and
 * their entries stay unstamped — a $0 statement line is noise, and stamping
 * rows a run didn't pay is exactly the mistake the payroll stamp filter
 * exists to prevent.
 */
export function groupEntriesForRun(
  entries: RunnableEntry[],
  fallbackRateByMember: Map<string, number | null>,
): RunItemDraft[] {
  const byMember = new Map<string, RunItemDraft>();

  for (const e of entries) {
    if (!e.employee_id || !e.clock_in_at || !e.clock_out_at) continue;
    // Unknown owner: no rate row was resolvable for them — skip rather than
    // silently price at $0 (the caller fetches rates for every owner id).
    if (!fallbackRateByMember.has(e.employee_id)) continue;
    const mins = Math.max(
      0,
      Math.round(
        (new Date(e.clock_out_at).getTime() -
          new Date(e.clock_in_at).getTime()) /
          60_000,
      ),
    );
    if (mins === 0) continue;

    const rate =
      e.booking?.hourly_rate_cents ??
      e.pay_rate_cents_snapshot ??
      fallbackRateByMember.get(e.employee_id) ??
      0;

    const item = byMember.get(e.employee_id) ?? {
      membershipId: e.employee_id,
      minutes: 0,
      entryCount: 0,
      totalCents: 0,
      entryIds: [],
    };
    item.minutes += mins;
    item.entryCount += 1;
    // Integer math per entry, same as payroll's bucket accumulation.
    item.totalCents += Math.round((mins * rate) / 60);
    item.entryIds.push(e.id);
    byMember.set(e.employee_id, item);
  }

  // Largest amounts first — the order a person scans a statement list.
  return [...byMember.values()].sort((a, b) => b.totalCents - a.totalCents);
}

export function runTotalCents(items: RunItemDraft[]): number {
  return items.reduce((s, i) => s + i.totalCents, 0);
}
