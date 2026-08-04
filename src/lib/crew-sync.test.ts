import { describe, it, expect } from "vitest";
import {
  assigneeKey,
  lifecycleByAssignee,
  withPriorLifecycle,
} from "./crew-sync";

const B = "b536cc7c";
const ANASTASIIA = "d9f63b54";
const ULIANA = "6b5e4b45";

const prior = [
  {
    booking_id: B,
    membership_id: ANASTASIIA,
    acceptance_status: "accepted",
    responded_at: "2026-06-04T10:00:00Z",
    completed_at: "2026-06-05T20:00:00Z",
  },
  {
    booking_id: B,
    membership_id: ULIANA,
    acceptance_status: "accepted",
    responded_at: "2026-06-04T11:00:00Z",
    completed_at: null,
  },
];

describe("crew lifecycle carry", () => {
  it("keeps acceptance and completion for someone already on the job", () => {
    // The bug: editing a price re-asked accepted cleaners to confirm, and
    // wiped the record that a split segment was finished.
    const rebuilt = { booking_id: B, membership_id: ANASTASIIA, is_primary: false };
    const out = withPriorLifecycle(rebuilt, lifecycleByAssignee(prior));
    expect(out).toMatchObject({
      acceptance_status: "accepted",
      responded_at: "2026-06-04T10:00:00Z",
      completed_at: "2026-06-05T20:00:00Z",
    });
  });

  it("leaves structural fields to the form", () => {
    // Promoting someone to primary must still change is_primary — only the
    // three lifecycle columns are carried.
    const rebuilt = { booking_id: B, membership_id: ULIANA, is_primary: true, split_index: 2 };
    const out = withPriorLifecycle(rebuilt, lifecycleByAssignee(prior));
    expect(out.is_primary).toBe(true);
    expect(out.split_index).toBe(2);
    expect(out.acceptance_status).toBe("accepted");
  });

  it("a genuinely new crew member starts clean", () => {
    const rebuilt = { booking_id: B, membership_id: "someone-new", is_primary: false };
    const out = withPriorLifecycle(rebuilt, lifecycleByAssignee(prior));
    expect(out).not.toHaveProperty("acceptance_status");
  });

  it("does not leak state across bookings", () => {
    // Same person, different job — the series path rewrites many bookings at
    // once, so keying on membership alone would copy one occurrence's
    // completion onto every other one.
    const otherBooking = {
      booking_id: "different-booking",
      membership_id: ANASTASIIA,
      is_primary: true,
    };
    const out = withPriorLifecycle(otherBooking, lifecycleByAssignee(prior));
    expect(out).not.toHaveProperty("completed_at");
  });

  it("tolerates junk rows", () => {
    expect(lifecycleByAssignee(null).size).toBe(0);
    expect(lifecycleByAssignee([{ booking_id: B }]).size).toBe(0);
  });

  it("keys on booking and membership together", () => {
    expect(assigneeKey({ booking_id: B, membership_id: ANASTASIIA })).toBe(
      `${B}:${ANASTASIIA}`,
    );
  });
});
