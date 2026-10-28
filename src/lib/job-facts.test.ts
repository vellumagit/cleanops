import { describe, it, expect } from "vitest";
import { jobFactsForMember } from "./job-facts";
import { deriveJobState } from "./job-state";
import type { JobStateView } from "./job-sync";

const names: Record<string, string> = {
  p: "Pristine Standard",
  a: "Alona Smirnova",
  n: "Anastasiia Rozhkova",
  i: "Ivanna Boyko",
};
const shift = (who: string, inAt: string, outAt: string | null = null) => ({
  id: who + inAt,
  name: names[who],
  employee_id: who,
  clock_in_at: inAt,
  clock_out_at: outAt,
});

function view(shifts: ReturnType<typeof shift>[], nowIso: string, crewIds = ["p", "a", "n", "i"]): JobStateView {
  const crew = crewIds.map((membership_id) => ({ membership_id, name: names[membership_id] }));
  const state = deriveJobState({
    booking: {
      status: "confirmed",
      scheduled_at: "2026-10-27T15:00:00Z",
      duration_minutes: 1080,
      total_cents: 36000,
      hourly_rate_cents: null,
      is_free: false,
      closed_at: null,
    },
    crew,
    shifts,
    now: new Date(nowIso).getTime(),
    autoCompleteAfterMinutes: 240,
  });
  return { state, summary: "", nameOf: (id) => names[id], crew, shifts, windowEndMs: state.windowEndMs };
}
const TZ = "America/Edmonton";

describe("jobFactsForMember", () => {
  it("tells her who's here and who isn't, with her own arrival first", () => {
    const v = view(
      [shift("n", "2026-10-27T14:59:00Z"), shift("a", "2026-10-27T14:59:00Z"), shift("p", "2026-10-27T15:00:00Z")],
      "2026-10-27T15:05:00Z",
    );
    expect(jobFactsForMember(v, "p", TZ)).toBe("You arrived 9:00 AM · 3 of 4 here · Ivanna hasn't arrived");
    // Ivanna, not yet arrived, sees the same picture without a "you".
    expect(jobFactsForMember(v, "i", TZ)).toBe("3 of 4 here");
  });

  it("shows finishes and no-shows", () => {
    const v = view(
      [
        shift("n", "2026-10-27T14:59:00Z", "2026-10-27T18:30:00Z"),
        shift("a", "2026-10-27T14:59:00Z"),
        shift("p", "2026-10-27T15:00:00Z"),
      ],
      "2026-10-28T09:30:00Z",
    );
    expect(jobFactsForMember(v, "p", TZ)).toBe(
      "You arrived 9:00 AM · 2 of 4 here · Anastasiia finished · Ivanna never clocked in",
    );
    expect(jobFactsForMember(v, "n", TZ)).toBe(
      "You finished 12:30 PM · 2 of 4 here · Ivanna never clocked in",
    );
  });

  it("says nothing on a solo job she hasn't started, and nothing once it's done", () => {
    expect(jobFactsForMember(view([], "2026-10-27T15:00:00Z", ["p"]), "p", TZ)).toBeNull();
    const done = view([shift("p", "2026-10-27T15:00:00Z", "2026-10-27T18:00:00Z")], "2026-10-27T18:01:00Z", ["p"]);
    expect(done.state.phase).toBe("done");
    expect(jobFactsForMember(done, "p", TZ)).toBeNull();
  });
});
