import { toast } from "sonner";

/**
 * A drop the board refused. A double-booking comes back with a key, and the
 * toast then carries a Book anyway button: one press makes the same move
 * with the overlap in it, so the office can put the visit down and sort the
 * other job out afterwards (Svitlana, 2026-11-23). Anything else is the
 * plain error it always was.
 */
export function showRefusedDrop(
  result: { error: string; bookAnyway?: string },
  bookAnyway: (key: string) => void,
): void {
  const key = result.bookAnyway;
  if (!key) {
    toast.error(result.error);
    return;
  }
  toast.error(result.error, {
    // Long enough to read two names and a time, and decide.
    duration: 30_000,
    action: { label: "Book anyway", onClick: () => bookAnyway(key) },
  });
}
