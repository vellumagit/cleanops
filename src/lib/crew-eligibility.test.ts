import { describe, expect, it } from "vitest";
import { activeCrewOnly, crewEligibility } from "./crew-eligibility";

const olha = { id: "olha", status: "active", name: "Olha Musnytska" };
const vira = { id: "vira", status: "active", name: "Vira Karpynska" };
const olga = { id: "olga", status: "disabled", name: "Olga Musnytska" };
const anna = { id: "anna", status: "disabled", name: "Anna Vasylieva" };

describe("crewEligibility", () => {
  it("active people may be on a job", () => {
    expect(crewEligibility({ submitted: ["olha", "vira"], members: [olha, vira] })).toEqual({ ok: true });
    expect(crewEligibility({ submitted: [], members: [] })).toEqual({ ok: true });
  });

  it("someone who is no longer active is refused by name, with what to do", () => {
    const res = crewEligibility({ submitted: ["olga", "vira"], members: [olga, vira] });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("Olga Musnytska is no longer active");
      expect(res.error).toContain("Take that name off the crew");
      // The old message: it named nobody, and refreshing changed nothing.
      expect(res.error).not.toMatch(/Refresh and try again/);
    }
  });

  it("names everyone when there are several", () => {
    const res = crewEligibility({ submitted: ["olga", "anna"], members: [olga, anna] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("Olga Musnytska and Anna Vasylieva are no longer active");
  });

  it("refuses an id from outside the company", () => {
    const res = crewEligibility({ submitted: ["olha", "stranger"], members: [olha] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/isn't part of this company/);
  });
});

describe("activeCrewOnly", () => {
  it("keeps the order and drops whoever is not active", () => {
    const crew = [{ membership_id: "olga" }, { membership_id: "vira" }, { membership_id: "olha" }];
    expect(activeCrewOnly(crew, new Set(["olha", "vira"]))).toEqual([{ membership_id: "vira" }, { membership_id: "olha" }]);
    expect(activeCrewOnly(crew, new Set())).toEqual([]);
  });
});

describe("seriesWithoutMember", () => {
  it("leaves a template she is not on alone", async () => {
    const { seriesWithoutMember } = await import("./crew-eligibility");
    expect(seriesWithoutMember({ assigned_to: "vira", crew: [{ membership_id: "vira" }] }, "olga")).toBeNull();
    expect(seriesWithoutMember({ assigned_to: null, crew: null }, "olga")).toBeNull();
  });

  it("a single-cleaner template (no stored crew) comes out unassigned", async () => {
    const { seriesWithoutMember } = await import("./crew-eligibility");
    expect(seriesWithoutMember({ assigned_to: "olga", crew: null }, "olga")).toEqual({ assigned_to: null, crew: null });
  });

  it("the rest of the crew stays, times and all, and one of them takes the old column", async () => {
    const { seriesWithoutMember } = await import("./crew-eligibility");
    const vira = { membership_id: "vira", start_offset_minutes: 60, duration_minutes: 120 };
    expect(
      seriesWithoutMember({ assigned_to: "olga", crew: [{ membership_id: "olga" }, vira, { membership_id: "olha" }] }, "olga"),
    ).toEqual({ assigned_to: "vira", crew: [vira, { membership_id: "olha" }] });
    // She was on the crew but not the old column: the column is untouched.
    expect(seriesWithoutMember({ assigned_to: "vira", crew: [vira, { membership_id: "olga" }] }, "olga")).toEqual({
      assigned_to: "vira",
      crew: [vira],
    });
  });
});

describe("inactiveCrewWarning", () => {
  it("says nothing when everyone on the job is active", async () => {
    const { inactiveCrewWarning } = await import("./crew-eligibility");
    expect(inactiveCrewWarning([], false)).toBeNull();
    expect(inactiveCrewWarning([], true)).toBeNull();
  });

  it("names the person and says what to do", async () => {
    const { inactiveCrewWarning } = await import("./crew-eligibility");
    const text = inactiveCrewWarning(["Olga Musnytska"], false);
    expect(text).toContain("Olga Musnytska is deactivated");
    expect(text).toContain("Change the crew");
    expect(text).not.toMatch(/recurring/);
  });

  it("on a recurring booking, points at the series", async () => {
    const { inactiveCrewWarning } = await import("./crew-eligibility");
    const text = inactiveCrewWarning(["Olga Musnytska", "Anna Vasylieva"], true);
    expect(text).toContain("Olga Musnytska and Anna Vasylieva are deactivated");
    expect(text).toContain("all future bookings");
    expect(text).toContain("recurring series");
  });

  it("only a job still to be done is worth warning about", async () => {
    const { jobStillOpen } = await import("./crew-eligibility");
    expect(jobStillOpen("confirmed")).toBe(true);
    expect(jobStillOpen("in_progress")).toBe(true);
    expect(jobStillOpen("completed")).toBe(false);
    expect(jobStillOpen("cancelled")).toBe(false);
  });
});
