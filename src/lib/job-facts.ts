import type { JobStateView } from "@/lib/job-sync";

/**
 * The facts line above a cleaner's button:
 *
 *   "You arrived 8:59 · 3 of 4 here · Ivanna hasn't arrived"
 *
 * Only facts about shifts — nothing she has to interpret, and no status
 * word like "in progress" that means something different to the office.
 * Null when there's nothing worth saying (a solo job she hasn't started).
 */
export function jobFactsForMember(
  view: JobStateView | null,
  membershipId: string,
  tz: string,
): string | null {
  if (!view) return null;
  const { state, nameOf, crew, shifts } = view;
  if (state.phase === "cancelled" || state.phase === "done") return null;

  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz,
    });
  const first = (id: string) => nameOf(id).split(/\s+/)[0] || "Someone";
  const others = (ids: string[]) => ids.filter((id) => id !== membershipId);

  const parts: string[] = [];
  const mine = shifts.filter((s) => s.employee_id === membershipId);
  const open = mine.find((s) => s.clock_out_at == null);
  if (open) {
    parts.push(`You arrived ${time(open.clock_in_at)}`);
  } else if (mine.length > 0) {
    const last = mine[mine.length - 1];
    if (last.clock_out_at) parts.push(`You finished ${time(last.clock_out_at)}`);
  }

  if (crew.length >= 2) {
    parts.push(`${state.onSite.length} of ${crew.length} here`);
    const finished = others(state.finished).map(first);
    if (finished.length > 0) parts.push(`${finished.join(", ")} finished`);
    const waiting = others(state.waitingOn).map(first);
    if (waiting.length > 0) {
      parts.push(`${waiting.join(", ")} ${waiting.length === 1 ? "hasn't" : "haven't"} arrived`);
    }
    const noShows = others(state.noShows).map(first);
    if (noShows.length > 0) parts.push(`${noShows.join(", ")} never clocked in`);
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}
