import type { ScheduleBooking } from "./data";

/**
 * Shared palette for scheduler card tones. 8 colors chosen to be
 * distinct at small sizes and readable against both light + dark
 * backgrounds. Also used for employee lane tones — picking a single
 * palette keeps the grid feeling cohesive regardless of which
 * color-by mode the owner chose.
 */
export const SCHEDULER_PALETTE = [
  "#0ea5e9", // sky
  "#8b5cf6", // violet
  "#10b981", // emerald
  "#f59e0b", // amber
  "#f43f5e", // rose
  "#06b6d4", // cyan
  "#d946ef", // fuchsia
  "#84cc16", // lime
] as const;

/** Status → semantic color. Separate from the palette because these
 *  are meaningful (red = cancelled, green = completed), not
 *  arbitrary lookup slots. */
const STATUS_COLORS: Record<string, string> = {
  pending: "#f59e0b", // amber
  confirmed: "#0ea5e9", // sky
  en_route: "#8b5cf6", // violet
  in_progress: "#06b6d4", // cyan
  completed: "#10b981", // emerald
  cancelled: "#f43f5e", // rose
};

/**
 * Hash a string to a palette index. Deterministic — the same client
 * or service type always gets the same color across the grid.
 */
function hashToIndex(key: string, range: number): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h << 5) - h + key.charCodeAt(i);
    h |= 0; // force 32-bit
  }
  return Math.abs(h) % range;
}

export type ColorBy = "employee" | "service" | "client" | "status";

/**
 * Resolve the accent color for a booking based on the selected
 * color-by mode. Pass the employee's lane index for "employee" mode
 * so we match the lane header; other modes don't need it.
 */
export function toneForBooking(
  booking: ScheduleBooking,
  colorBy: ColorBy,
  employeeLaneIdx: number,
): string {
  switch (colorBy) {
    case "service":
      return SCHEDULER_PALETTE[
        hashToIndex(booking.service_type ?? "", SCHEDULER_PALETTE.length)
      ];
    case "client":
      return SCHEDULER_PALETTE[
        hashToIndex(booking.client_name ?? "", SCHEDULER_PALETTE.length)
      ];
    case "status":
      return STATUS_COLORS[booking.status] ?? "#64748b"; // slate fallback
    case "employee":
    default:
      return SCHEDULER_PALETTE[
        employeeLaneIdx % SCHEDULER_PALETTE.length
      ];
  }
}

/**
 * Map an employee row/column index to their lane color. Lane headers
 * always use this — they don't shift with color-by, since the header
 * identifies the person regardless of card coloring.
 */
export function toneForEmployee(idx: number): string {
  return SCHEDULER_PALETTE[idx % SCHEDULER_PALETTE.length];
}
