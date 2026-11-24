import { describe, expect, it } from "vitest";
import {
  handSetAtRisk,
  handSetKey,
  handSetQuestion,
  keepEntries,
  keptSentence,
  planRebuild,
  readHandSetAnswer,
  type LaterVisit,
} from "./series-hand-set";

const tz = "America/Regina";
const at = (day: string, hhmm = "16:00") => `${day}T${hhmm}:00.000Z`; // 16:00Z = 10:00 AM Regina

const plain = (id: string, day: string): LaterVisit => ({
  id,
  scheduled_at: at(day),
  time_set_by_hand_at: null,
  crew_set_by_hand_at: null,
});
// Every three weeks on Thursday. The Jan 14 visit was dragged to Friday
// afternoon; the Feb 4 visit has its own cleaner for that week.
const dec24 = plain("dec24", "2026-12-24");
const moved: LaterVisit = { id: "jan15", scheduled_at: at("2027-01-15", "20:00"), time_set_by_hand_at: "x", crew_set_by_hand_at: null };
const ownCrew: LaterVisit = { ...plain("feb04", "2027-02-04"), crew_set_by_hand_at: "x" };
const later = [dec24, moved, ownCrew];

describe("handSetAtRisk", () => {
  it("a save that only changes the price asks nothing, and keeps an own crew quietly", () => {
    expect(handSetAtRisk(later, { scheduleChanges: false, crewChanges: false })).toEqual({ ask: [], quietCrew: ["feb04"] });
  });

  it("a crew change asks about the visit with its own crew, not the moved one", () => {
    const r = handSetAtRisk(later, { scheduleChanges: false, crewChanges: true });
    expect(r.ask).toEqual([{ id: "feb04", scheduledAt: ownCrew.scheduled_at, moved: false, ownCrew: true }]);
    expect(r.quietCrew).toEqual([]);
  });

  it("a schedule change asks about the moved visit; the own crew is kept quietly", () => {
    const r = handSetAtRisk(later, { scheduleChanges: true, crewChanges: false });
    expect(r.ask.map((v) => v.id)).toEqual(["jan15"]);
    expect(r.quietCrew).toEqual(["feb04"]);
  });

  it("a series with nothing changed by hand is never asked", () => {
    expect(handSetAtRisk([dec24], { scheduleChanges: true, crewChanges: true })).toEqual({ ask: [], quietCrew: [] });
  });
});

describe("the answer", () => {
  const save = { scheduleChanges: true, crewChanges: true };
  const { ask } = handSetAtRisk(later, save);

  it("is good only for the visits it was asked about", () => {
    const key = handSetKey(ask);
    expect(readHandSetAnswer(`keep|${key}`, ask)).toBe("keep");
    expect(readHandSetAnswer(`replace|${key}`, ask)).toBe("replace");
    expect(readHandSetAnswer(`keep|${key}`, ask.slice(0, 1)), "another visit dropped out since").toBeNull();
    expect(readHandSetAnswer("keep", ask)).toBeNull();
    expect(readHandSetAnswer(`maybe|${key}`, ask)).toBeNull();
  });

  it("keep: each visit keeps what was changed on it", () => {
    expect(keepEntries(later, save, "keep")).toEqual([
      { id: "jan15", scheduledAt: moved.scheduled_at, time: true, crew: false },
      { id: "feb04", scheduledAt: ownCrew.scheduled_at, time: false, crew: true },
    ]);
  });

  it("replace, or no answer: nothing is kept that the save changes", () => {
    expect(keepEntries(later, save, "replace")).toEqual([]);
    expect(keepEntries(later, save, null)).toEqual([]);
  });

  it("replace on a schedule-only save still keeps the own crew: the save is not about crew", () => {
    expect(keepEntries(later, { scheduleChanges: true, crewChanges: false }, "replace")).toEqual([
      { id: "feb04", scheduledAt: ownCrew.scheduled_at, time: false, crew: true },
    ]);
  });
});

describe("planRebuild", () => {
  const laterInOrder = later.map((v) => ({ id: v.id, scheduled_at: v.scheduled_at }));

  it("the series moves from 10 to 11: the moved visit stays, and its Thursday is not written again", () => {
    const occurrences = [at("2026-12-24", "17:00"), at("2027-01-14", "17:00"), at("2027-02-04", "17:00")];
    const plan = planRebuild(
      [{ id: "jan15", scheduledAt: moved.scheduled_at, time: true, crew: false }],
      laterInOrder,
      occurrences,
    );
    expect(plan.occurrences).toEqual([occurrences[0], occurrences[2]]);
    expect(plan.keep).toEqual([{ id: "jan15", time: true, crew: false, moveTo: null }]);
    expect(plan.dropped).toEqual([]);
  });

  it("a visit keeping only its crew moves to its new slot", () => {
    const occurrences = [at("2026-12-23", "17:00"), at("2027-01-13", "17:00"), at("2027-02-03", "17:00")];
    const plan = planRebuild(
      [{ id: "feb04", scheduledAt: ownCrew.scheduled_at, time: false, crew: true }],
      laterInOrder,
      occurrences,
    );
    expect(plan.keep).toEqual([{ id: "feb04", time: false, crew: true, moveTo: occurrences[2] }]);
    expect(plan.occurrences).toEqual(occurrences.slice(0, 2));
  });

  it("the frequency changes and a crew-only visit has no slot: it is replaced like the rest", () => {
    // Now monthly: Dec 24, Jan 24. Nothing near Feb 4.
    const occurrences = [at("2026-12-24"), at("2027-01-24")];
    const plan = planRebuild(
      [{ id: "feb04", scheduledAt: ownCrew.scheduled_at, time: false, crew: true }],
      laterInOrder,
      occurrences,
    );
    expect(plan.keep).toEqual([]);
    expect(plan.dropped).toEqual(["feb04"]);
    expect(plan.occurrences).toEqual(occurrences);
  });

  it("a moved visit far from every new slot stays as an extra; nothing is taken out", () => {
    const occurrences = [at("2026-12-24"), at("2027-03-24")];
    const plan = planRebuild(
      [{ id: "jan15", scheduledAt: moved.scheduled_at, time: true, crew: false }],
      laterInOrder,
      occurrences,
    );
    expect(plan.keep).toEqual([{ id: "jan15", time: true, crew: false, moveTo: null }]);
    expect(plan.occurrences).toEqual(occurrences);
  });

  it("never writes a new visit at the same instant as one that stays", () => {
    const same = moved.scheduled_at;
    const plan = planRebuild(
      [{ id: "jan15", scheduledAt: same, time: true, crew: false }],
      [{ id: "jan15", scheduled_at: same }],
      [same],
    );
    expect(plan.occurrences).toEqual([]);
  });
});

describe("the words", () => {
  it("the question names each visit and what was changed on it", () => {
    const { ask } = handSetAtRisk(later, { scheduleChanges: true, crewChanges: true });
    expect(handSetQuestion(ask, tz)).toBe(
      "2 later visits were changed by hand: Fri, Jan 15 (moved by hand); Thu, Feb 4 (its own crew). This save would put them back in line with the series. Nothing was saved yet. Keep those visits as they are, or change them too?",
    );
    expect(handSetQuestion(ask.slice(0, 1), tz)).toMatch(/^One later visit was changed by hand: Fri, Jan 15 \(moved by hand\)\./);
  });

  it("afterwards: which visits were left alone", () => {
    expect(keptSentence([], tz)).toBeNull();
    expect(keptSentence([{ scheduledAt: moved.scheduled_at }], tz)).toBe(
      "One visit you had changed by hand was left as it is: Fri, Jan 15. Open it to change it.",
    );
    expect(keptSentence([{ scheduledAt: ownCrew.scheduled_at }, { scheduledAt: moved.scheduled_at }], tz)).toBe(
      "2 visits you had changed by hand were left as they are: Fri, Jan 15; Thu, Feb 4. Open one to change it.",
    );
  });
});
