import { describe, expect, it } from "vitest";
import {
  formatSegmentWindow,
  resolveSegmentWindows,
  segmentsOverlap,
  segmentsSpanMinutes,
} from "./booking-segments";

describe("formatSegmentWindow", () => {
  const at = "2026-10-02T14:30";

  it("renders a plain window", () => {
    expect(formatSegmentWindow(at, 0, 480)).toBe("2:30 PM – 10:30 PM");
  });

  it("offsets the start", () => {
    expect(formatSegmentWindow(at, 90, 240)).toBe("4:00 PM – 8:00 PM");
  });

  it("marks a shift landing exactly on midnight as next-day", () => {
    // 4:00 PM + 8h is 12:00 AM, which really is the following date. Saying so
    // is the point of the marker — otherwise it reads as noon.
    expect(formatSegmentWindow(at, 90, 480)).toBe("4:00 PM – 12:00 AM (+1d)");
  });

  it("flags crossing midnight — today's job does exactly this", () => {
    // 14:30 + 210m start, 750m long → ends 06:30 the NEXT day.
    expect(formatSegmentWindow(at, 210, 750)).toBe("6:00 PM – 6:30 AM (+1d)");
  });

  it("counts multiple days over", () => {
    expect(formatSegmentWindow(at, 0, 2 * 1440)).toBe("2:30 PM – 2:30 PM (+2d)");
  });

  it("renders noon and midnight as 12, not 0", () => {
    expect(formatSegmentWindow("2026-10-02T00:00", 0, 720)).toBe(
      "12:00 AM – 12:00 PM",
    );
  });

  it("returns null for an empty or unparseable date field", () => {
    expect(formatSegmentWindow("", 0, 60)).toBeNull();
    expect(formatSegmentWindow("not-a-date", 0, 60)).toBeNull();
  });

  it("does not depend on the viewer's timezone", () => {
    // Pure arithmetic on the typed clock face — no Date, no locale. If this
    // ever regresses to Date the value would shift per viewer.
    expect(formatSegmentWindow("2026-01-15T09:05", 55, 60)).toBe(
      "10:00 AM – 11:00 AM",
    );
  });
});

describe("resolveSegmentWindows", () => {
  it("lays legacy segments end-to-end, exactly as the old editor did", () => {
    // ~20 live bookings look like this: no start_offset_minutes anywhere.
    const out = resolveSegmentWindows([
      { assigned_to: "a", duration_minutes: 180 },
      { assigned_to: "b", duration_minutes: 240 },
      { assigned_to: "c", duration_minutes: 120 },
    ]);

    expect(out.map((s) => s.start_offset_minutes)).toEqual([0, 180, 420]);
  });

  it("honours explicit offsets, including overlapping ones", () => {
    // The 2026-10-02 shape: three people on one job at different times.
    const out = resolveSegmentWindows([
      { assigned_to: "veronika", start_offset_minutes: 0, duration_minutes: 480 },
      { assigned_to: "olha", start_offset_minutes: 90, duration_minutes: 480 },
      { assigned_to: "anastasiia", start_offset_minutes: 210, duration_minutes: 750 },
    ]);

    expect(out.map((s) => s.start_offset_minutes)).toEqual([0, 90, 210]);
  });

  it("allows a gap — someone returning later in the day", () => {
    const out = resolveSegmentWindows([
      { assigned_to: "a", start_offset_minutes: 0, duration_minutes: 120 },
      { assigned_to: "a", start_offset_minutes: 480, duration_minutes: 120 },
    ]);

    expect(out.map((s) => s.start_offset_minutes)).toEqual([0, 480]);
  });

  it("falls back per segment, so a partly-filled array still resolves", () => {
    const out = resolveSegmentWindows([
      { assigned_to: "a", duration_minutes: 120 },
      { assigned_to: "b", start_offset_minutes: 60, duration_minutes: 120 },
      { assigned_to: "c", duration_minutes: 60 },
    ]);

    // a → cumulative 0; b → explicit 60; c → cumulative 120+120.
    expect(out.map((s) => s.start_offset_minutes)).toEqual([0, 60, 240]);
  });

  it("advances the fallback past unassigned rows, as the old code did", () => {
    const out = resolveSegmentWindows([
      { assigned_to: "", duration_minutes: 100 },
      { assigned_to: "b", duration_minutes: 50 },
    ]);

    expect(out[1].start_offset_minutes).toBe(100);
    expect(out[0].assigned_to).toBeNull();
  });

  it("coerces junk without throwing", () => {
    const out = resolveSegmentWindows([
      { assigned_to: "a", duration_minutes: null, start_offset_minutes: -5 },
    ]);

    expect(out[0]).toMatchObject({ start_offset_minutes: 0, duration_minutes: 0 });
  });

  it("preserves submitted order as index", () => {
    const out = resolveSegmentWindows([
      { assigned_to: "a", duration_minutes: 60 },
      { assigned_to: "b", duration_minutes: 60 },
    ]);
    expect(out.map((s) => s.index)).toEqual([0, 1]);
  });
});

describe("segmentsOverlap", () => {
  const r = resolveSegmentWindows;

  it("is false for a clean hand-off", () => {
    expect(
      segmentsOverlap(
        r([
          { assigned_to: "a", duration_minutes: 180 },
          { assigned_to: "b", duration_minutes: 180 },
        ]),
      ),
    ).toBe(false);
  });

  it("is true when two people are on site together", () => {
    expect(
      segmentsOverlap(
        r([
          { assigned_to: "a", start_offset_minutes: 0, duration_minutes: 180 },
          { assigned_to: "b", start_offset_minutes: 60, duration_minutes: 180 },
        ]),
      ),
    ).toBe(true);
  });

  it("is false for a gap", () => {
    expect(
      segmentsOverlap(
        r([
          { assigned_to: "a", start_offset_minutes: 0, duration_minutes: 60 },
          { assigned_to: "b", start_offset_minutes: 300, duration_minutes: 60 },
        ]),
      ),
    ).toBe(false);
  });

  it("ignores unassigned rows", () => {
    expect(
      segmentsOverlap(
        r([
          { assigned_to: "", start_offset_minutes: 0, duration_minutes: 600 },
          { assigned_to: "b", start_offset_minutes: 0, duration_minutes: 60 },
        ]),
      ),
    ).toBe(false);
  });
});

describe("segmentsSpanMinutes", () => {
  const r = resolveSegmentWindows;

  it("equals the sum when segments are end-to-end", () => {
    expect(
      segmentsSpanMinutes(
        r([
          { assigned_to: "a", duration_minutes: 180 },
          { assigned_to: "b", duration_minutes: 240 },
        ]),
      ),
    ).toBe(420);
  });

  it("is shorter than the sum when they overlap — the number that matters", () => {
    // 8h + 8h + 12.5h of labour, but the job itself runs 16h.
    const segs = r([
      { assigned_to: "veronika", start_offset_minutes: 0, duration_minutes: 480 },
      { assigned_to: "olha", start_offset_minutes: 90, duration_minutes: 480 },
      { assigned_to: "anastasiia", start_offset_minutes: 210, duration_minutes: 750 },
    ]);

    expect(segmentsSpanMinutes(segs)).toBe(960);
    const labour = segs.reduce((n, s) => n + s.duration_minutes, 0);
    expect(labour).toBe(1710);
  });

  it("counts a gap as part of the span", () => {
    expect(
      segmentsSpanMinutes(
        r([
          { assigned_to: "a", start_offset_minutes: 0, duration_minutes: 60 },
          { assigned_to: "a", start_offset_minutes: 300, duration_minutes: 60 },
        ]),
      ),
    ).toBe(360);
  });

  it("is zero with nothing assigned", () => {
    expect(segmentsSpanMinutes(r([]))).toBe(0);
  });
});
