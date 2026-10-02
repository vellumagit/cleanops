import { describe, expect, it } from "vitest";
import { orderCrewByWorkload, type CrewAssignment } from "./crew-order";

const emp = (id: string, name: string) => ({ id, name });

/** Primary-only job, the common case. */
const job = (assignedTo: string | null): CrewAssignment => ({
  assigned_to: assignedTo,
  all_assignee_ids: assignedTo ? [assignedTo] : [],
});

/** Team job — primary plus additional crew, as booking_assignees stores it. */
const teamJob = (...ids: string[]): CrewAssignment => ({
  assigned_to: ids[0] ?? null,
  all_assignee_ids: ids,
});

describe("orderCrewByWorkload", () => {
  it("puts the busiest cleaner in the first lane", () => {
    const crew = [emp("a", "Anna"), emp("o", "Olha"), emp("v", "Veronika")];
    const bookings = [job("v"), job("v"), job("v"), job("o"), job("o"), job("a")];

    const { working } = orderCrewByWorkload(crew, bookings);

    expect(working.map((e) => e.name)).toEqual(["Veronika", "Olha", "Anna"]);
  });

  it("separates the crew with no work in this view", () => {
    const crew = [
      emp("o", "Olha"),
      emp("x", "Alona"),
      emp("y", "Diana"),
      emp("z", "Romana"),
    ];

    const { working, idle, partitioned } = orderCrewByWorkload(crew, [job("o")]);

    expect(working.map((e) => e.name)).toEqual(["Olha"]);
    expect(idle.map((e) => e.name)).toEqual(["Alona", "Diana", "Romana"]);
    expect(partitioned).toBe(true);
  });

  it("counts secondary crew as working, not idle", () => {
    // Marharyta is additional crew, never the primary. Counting only
    // assigned_to filed her as idle while her lane visibly held the job.
    const crew = [emp("a", "Anna"), emp("m", "Marharyta")];

    const { working, idle } = orderCrewByWorkload(crew, [teamJob("a", "m")]);

    expect(working.map((e) => e.name)).toEqual(["Anna", "Marharyta"]);
    expect(idle).toEqual([]);
  });

  it("ignores unassigned bookings — they belong to nobody's lane", () => {
    const crew = [emp("a", "Anna"), emp("b", "Bea"), emp("c", "Cleo")];

    const { working, idle } = orderCrewByWorkload(crew, [job(null), job(null)]);

    expect(working).toEqual([]);
    expect(idle).toHaveLength(3);
  });

  it("keeps idle members in the caller's alphabetical order", () => {
    const crew = [emp("a", "Alona"), emp("d", "Diana"), emp("r", "Romana")];

    const { idle } = orderCrewByWorkload(crew, []);

    expect(idle.map((e) => e.name)).toEqual(["Alona", "Diana", "Romana"]);
  });

  it("does not partition an empty week — that renders two empty headings", () => {
    const crew = [emp("a", "Anna"), emp("b", "Bea"), emp("c", "Cleo"), emp("d", "Dee")];

    const { partitioned, idle } = orderCrewByWorkload(crew, []);

    expect(partitioned).toBe(false);
    expect(idle).toHaveLength(4);
  });

  it("does not partition when only one or two lanes would be hidden", () => {
    // A small crew where nearly everyone works: the collapse costs a
    // heading and a disclosure to hide two rows. Stay flat.
    const crew = [emp("a", "Anna"), emp("b", "Bea"), emp("c", "Cleo")];

    const { partitioned } = orderCrewByWorkload(crew, [job("a")]);

    expect(partitioned).toBe(false);
  });

  it("partitions Svit's real shape: 4 of 16 lanes hold the week", () => {
    const working = ["Olha", "Veronika", "Marharyta", "Anna"];
    const crew = [
      ...working.map((n) => emp(n, n)),
      ...Array.from({ length: 12 }, (_, i) => emp(`idle${i}`, `Idle ${i}`)),
    ];
    const bookings = [
      ...Array.from({ length: 8 }, () => job("Olha")),
      ...Array.from({ length: 6 }, () => job("Veronika")),
      ...Array.from({ length: 3 }, () => job("Marharyta")),
      job("Anna"),
    ];

    const order = orderCrewByWorkload(crew, bookings);

    expect(order.partitioned).toBe(true);
    expect(order.working.map((e) => e.name)).toEqual(working);
    expect(order.idle).toHaveLength(12);
  });

  it("never drops or duplicates a member", () => {
    const crew = Array.from({ length: 16 }, (_, i) => emp(`m${i}`, `M${i}`));
    const bookings = [job("m3"), teamJob("m7", "m11"), job(null)];

    const { working, idle } = orderCrewByWorkload(crew, bookings);

    expect(working.length + idle.length).toBe(16);
    const ids = [...working, ...idle].map((e) => e.id);
    expect(new Set(ids).size).toBe(16);
  });
});
