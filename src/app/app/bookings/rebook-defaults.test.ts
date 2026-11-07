import { describe, expect, it } from "vitest";
import { rebookDefaults, type RebookSource } from "./rebook-defaults";

// Ranj Asi, Thu Nov 5 2026 9:30 AM Alberta: the job Svitlana pressed
// "Book again" on four times, wanting Saturday, Sunday and Monday.
const ranj: RebookSource = {
  client_id: "ranj",
  assigned_to: "anna",
  scheduled_at: "2026-11-05T15:30:00+00:00",
  duration_minutes: 600,
  service_type: "deep",
  service_type_id: "svc-deep",
  total_cents: 10000,
  is_free: false,
  hourly_rate_cents: null,
  address: "1 Some St",
  property_id: null,
  notes: "Buzzer 42",
  splits: [],
  divide_hours_evenly: false,
};
const tz = "America/Regina";

describe("rebookDefaults", () => {
  it("Book again carries everything but the date, which is left for the owner", () => {
    const d = rebookDefaults(ranj, [{ membership_id: "anna", is_primary: true }], { tz, keepDate: false });
    expect(d.client_id).toBe("ranj");
    expect(d.assigned_to).toBe("anna");
    expect(d.duration_minutes).toBe(600);
    expect(d.service_type_id).toBe("svc-deep");
    expect(d.total_dollars).toBe("100.00");
    expect(d.address).toBe("1 Some St");
    expect(d.notes).toBe("Buzzer 42");
    expect(d.scheduled_at_local).toBeUndefined();
  });

  it("Duplicate keeps the source's date, as a wall clock in the org's zone", () => {
    const d = rebookDefaults(ranj, [], { tz, keepDate: true });
    expect(d.scheduled_at_local).toBe("2026-11-05T09:30");
  });

  it("the crew comes along, without repeating the lead", () => {
    const d = rebookDefaults(
      ranj,
      [
        { membership_id: "anna", is_primary: true },
        { membership_id: "vira", is_primary: false },
        { membership_id: "olha", is_primary: false },
        { membership_id: "vira", is_primary: false },
      ],
      { tz, keepDate: false },
    );
    expect(d.additional_assignees).toEqual(["vira", "olha"]);
  });

  it("split segments and a free price survive; junk segments don't", () => {
    const d = rebookDefaults(
      {
        ...ranj,
        is_free: true,
        splits: [
          { assigned_to: "a", duration_minutes: 240, start_offset_minutes: 0 },
          { assigned_to: "b", duration_minutes: 240, start_offset_minutes: 240 },
          { assigned_to: "", duration_minutes: 0 },
        ],
      },
      [],
      { tz, keepDate: false },
    );
    expect(d.is_free).toBe(true);
    expect(d.splits).toEqual([
      { assigned_to: "a", duration_minutes: 240, start_offset_minutes: 0 },
      { assigned_to: "b", duration_minutes: 240, start_offset_minutes: 240 },
    ]);
  });
});
