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
    const rebuilt = {
      booking_id: B,
      membership_id: ANASTASIIA,
      is_primary: false,
    };
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
    const rebuilt = {
      booking_id: B,
      membership_id: ULIANA,
      is_primary: true,
      split_index: 2,
    };
    const out = withPriorLifecycle(rebuilt, lifecycleByAssignee(prior));
    expect(out.is_primary).toBe(true);
    expect(out.split_index).toBe(2);
    expect(out.acceptance_status).toBe("accepted");
  });

  it("a genuinely new crew member starts clean", () => {
    // Asserted "not.toHaveProperty" until 2026-08-08, encoding the assumption
    // that an absent key lets the DB default apply. It does not: these rows
    // are inserted as one array and PostgREST unifies the column list, so an
    // absent key becomes an explicit NULL and the NOT NULL constraint fires.
    // "Clean" means pending, spelled out — not missing.
    const rebuilt = {
      booking_id: B,
      membership_id: "someone-new",
      is_primary: false,
    };
    const out = withPriorLifecycle(rebuilt, lifecycleByAssignee(prior));
    expect(out.acceptance_status).toBe("pending");
    expect(out.responded_at).toBeNull();
    expect(out.completed_at).toBeNull();
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
    // Null, not absent — the other occurrence's completion must not follow
    // them here, but the key still has to be present so the batch stays
    // homogeneous.
    expect(out.completed_at).toBeNull();
    expect(out.acceptance_status).toBe("pending");
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

describe("every row carries the same keys", () => {
  const MARIA = "aa11bb22"; // brand new — no prior row

  it("gives a brand-new crew member an explicit pending, not a missing key", () => {
    // The production failure this exists to prevent:
    //   null value in column "acceptance_status" of relation
    //   "booking_assignees" violates not-null constraint
    // These rows go to PostgREST as ONE array. PostgREST unifies the column
    // list across every row in it, so a row that merely OMITS a key gets an
    // explicit NULL — the DB default never gets a chance. The old code
    // returned new rows untouched and relied on that default.
    const row = withPriorLifecycle(
      { booking_id: B, membership_id: MARIA, is_primary: false },
      lifecycleByAssignee(prior),
    );
    expect(row.acceptance_status).toBe("pending");
    expect(row.responded_at).toBeNull();
    expect(row.completed_at).toBeNull();
  });

  it("emits an identical key set for existing and new crew in one batch", () => {
    // Adding someone to a job that already has crew — the most ordinary edit
    // there is, and the exact shape that failed every time.
    const map = lifecycleByAssignee(prior);
    const batch = [
      { booking_id: B, membership_id: ANASTASIIA, is_primary: true },
      { booking_id: B, membership_id: MARIA, is_primary: false },
    ].map((r) => withPriorLifecycle(r, map));

    const keySets = batch.map((r) => Object.keys(r).sort().join(","));
    expect(new Set(keySets).size).toBe(1);
    for (const r of batch) {
      expect(r).toHaveProperty("acceptance_status");
      expect(r.acceptance_status).not.toBeNull();
      expect(r.acceptance_status).not.toBeUndefined();
    }
  });

  it("still does not overwrite what the existing member had", () => {
    const map = lifecycleByAssignee(prior);
    const row = withPriorLifecycle(
      { booking_id: B, membership_id: ANASTASIIA, is_primary: true },
      map,
    );
    expect(row.acceptance_status).toBe("accepted");
    expect(row.completed_at).toBe("2026-06-05T20:00:00Z");
  });

  it("treats a prior row missing the column as pending rather than null", () => {
    // Defensive: a select that forgets acceptance_status would otherwise put
    // undefined in the map and reintroduce the same NOT NULL failure.
    const thin = lifecycleByAssignee([
      { booking_id: B, membership_id: ULIANA },
    ]);
    const row = withPriorLifecycle(
      { booking_id: B, membership_id: ULIANA, is_primary: false },
      thin,
    );
    expect(row.acceptance_status).toBe("pending");
  });
});
