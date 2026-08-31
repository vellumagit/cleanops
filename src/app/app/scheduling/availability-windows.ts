import type { AvailabilityByEmployee, AvailabilityWindow } from "./data";

/**
 * Declared availability for one employee on one calendar date.
 *
 * Resolution rule matches the schema's design (20260422030000): a
 * kind='custom' override REPLACES the weekly slots for that date; the
 * weekly slots apply otherwise, keyed by day-of-week 0=Sun…6=Sat (same
 * convention as the field editor). An empty result means "nothing
 * declared" — unknown, not unavailable.
 */
export function availabilityWindowsFor(
  entry: AvailabilityByEmployee[string] | undefined,
  dateStr: string,
): AvailabilityWindow[] {
  if (!entry) return [];
  const custom = entry.custom[dateStr];
  if (custom && custom.length > 0) return custom;
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return entry.weekly[dow] ?? [];
}

/** "09:00–17:00, 19:00–21:00" — compact label for a cell or header. */
export function formatAvailabilityWindows(
  windows: AvailabilityWindow[],
): string {
  return windows.map((w) => `${w.start}–${w.end}`).join(", ");
}
