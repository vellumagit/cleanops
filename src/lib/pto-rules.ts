/**
 * Who may do what to a time-off request, and what doing it costs.
 *
 * Two actors, two different rulebooks:
 *
 *   The REQUESTER may cancel or change their own request — but changing an
 *   APPROVED request revokes the approval. A manager said yes to specific
 *   dates; different dates are a different question. Without that rule a
 *   worker could get one day approved and quietly stretch it to a week.
 *
 *   OWNERS/MANAGERS may edit anything and keep the status they chose —
 *   they ARE the approval, so their edit re-answers the question itself.
 *
 * Dates are DATE columns holding org-local calendar days (compare as
 * strings, "2026-08-17" < "2026-08-18" — no Date parsing, no timezone
 * shear; see wall-clock.ts for why that class of bug matters here).
 */

export type PtoStatus = "pending" | "approved" | "declined" | "cancelled";

/**
 * A requester may cancel while the request still governs any future day:
 * pending or approved, and not entirely in the past. Cancelling mid-leave
 * is allowed — "I'm coming back early" is a real case — and simply frees
 * the remaining days on the schedule.
 */
export function workerCanCancel(
  status: PtoStatus,
  endDate: string,
  todayYmd: string,
): boolean {
  return (status === "pending" || status === "approved") && endDate >= todayYmd;
}

/**
 * A requester may reshape a request only before it starts. Once the leave
 * is underway the past days already happened; the honest edit for "coming
 * back early" is cancel + a fresh request for the shorter stay.
 */
export function workerCanEdit(
  status: PtoStatus,
  startDate: string,
  todayYmd: string,
): boolean {
  return (
    (status === "pending" || status === "approved") && startDate >= todayYmd
  );
}

/**
 * What a requester's edit does to the status: an approved request loses
 * its approval and goes back to the manager's queue. Pending stays
 * pending — it was never answered.
 */
export function statusAfterWorkerEdit(prev: PtoStatus): "pending" {
  void prev;
  return "pending";
}

/** Shared field validation for create AND both edit paths.
 *
 * `allowZeroHours` is the subcontractor mode: their time off is unpaid
 * unavailability, so hours are forced to 0 by the caller and must not
 * fail validation — offering paid-looking PTO to a contractor is the
 * misclassification paper engagement.ts exists to prevent. */
export function validatePtoFields(
  fields: {
    start_date: string;
    end_date: string;
    hours: number;
  },
  opts?: { allowZeroHours?: boolean },
): string | null {
  if (!fields.start_date || !fields.end_date) {
    return "Start date and end date are required.";
  }
  if (fields.end_date < fields.start_date) {
    return "End date must be on or after start date.";
  }
  if (opts?.allowZeroHours && fields.hours === 0) return null;
  if (!Number.isFinite(fields.hours) || fields.hours <= 0 || fields.hours > 200) {
    return "Hours must be between 1 and 200.";
  }
  return null;
}
