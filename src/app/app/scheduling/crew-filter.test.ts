import { describe, expect, it } from "vitest";
import { bookingMatchesCrewFilter, crewIdsOf } from "./crew-filter";

const bk = (
  assigned_to: string | null,
  all_assignee_ids: string[] = [],
  staffed = assigned_to != null || all_assignee_ids.length > 0,
) => ({ assigned_to, all_assignee_ids, staffed });

const visible = (...ids: string[]) => new Set(ids);

describe("crewIdsOf", () => {
  it("prefers the crew list", () => {
    expect(crewIdsOf(bk("olha", ["olha", "uliana"]))).toEqual([
      "olha",
      "uliana",
    ]);
  });

  it("falls back to the lone assignee", () => {
    expect(crewIdsOf(bk("olha"))).toEqual(["olha"]);
  });

  it("is empty when nobody is on it", () => {
    expect(crewIdsOf(bk(null))).toEqual([]);
  });
});

describe("bookingMatchesCrewFilter", () => {
  it("shows a job when filtering by a SECONDARY crew member", () => {
    // The reported bug. Olha is primary, Uliana is crew; filtering to Uliana
    // used to hide this entirely because assigned_to is Olha.
    const job = bk("olha", ["olha", "uliana"]);

    expect(bookingMatchesCrewFilter(job, visible("uliana"))).toBe(true);
  });

  it("still shows it when filtering by the primary", () => {
    expect(
      bookingMatchesCrewFilter(bk("olha", ["olha", "uliana"]), visible("olha")),
    ).toBe(true);
  });

  it("hides it when nobody on it is selected", () => {
    expect(
      bookingMatchesCrewFilter(bk("olha", ["olha", "uliana"]), visible("anna")),
    ).toBe(false);
  });

  it("handles a solo job with no crew rows", () => {
    expect(bookingMatchesCrewFilter(bk("olha"), visible("olha"))).toBe(true);
    expect(bookingMatchesCrewFilter(bk("olha"), visible("anna"))).toBe(false);
  });

  it("always shows unstaffed work so the unassigned tray survives filtering", () => {
    const unstaffed = bk(null, [], false);

    expect(bookingMatchesCrewFilter(unstaffed, visible("anna"))).toBe(true);
    expect(bookingMatchesCrewFilter(unstaffed, new Set())).toBe(true);
  });

  it("filters a CREW-ONLY job by its crew, not past the filter", () => {
    // assigned_to is null but real people are on it. The old `!assigned_to`
    // test let this bypass the filter completely.
    const crewOnly = bk(null, ["uliana"], true);

    expect(bookingMatchesCrewFilter(crewOnly, visible("uliana"))).toBe(true);
    expect(bookingMatchesCrewFilter(crewOnly, visible("anna"))).toBe(false);
  });

  it("keeps a subcontractor-covered job visible — no name to match on", () => {
    // staffed via a claimed bench offer: nobody in the crew list, but it is
    // covered. Hiding it would make it unreachable from the board.
    const sub = bk(null, [], true);

    expect(bookingMatchesCrewFilter(sub, visible("anna"))).toBe(true);
  });

  it("shows nothing staffed when the filter selects nobody", () => {
    expect(bookingMatchesCrewFilter(bk("olha"), new Set())).toBe(false);
  });
});
