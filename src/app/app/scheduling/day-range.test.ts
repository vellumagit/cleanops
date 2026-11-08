import { describe, expect, it } from "vitest";
import { orgLocalDayUtcRange } from "./day-range";

describe("organization-local schedule day bounds", () => {
  it("includes evening bookings that fall on the next UTC date", () => {
    const { start, end } = orgLocalDayUtcRange(
      "2026-11-09",
      "America/Edmonton",
    );
    const eveningBooking = new Date("2026-11-10T02:00:00.000Z");

    expect(start.toISOString()).toBe("2026-11-09T07:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-10T07:00:00.000Z");
    expect(eveningBooking >= start && eveningBooking < end).toBe(true);
  });

  it("uses a 23-hour UTC range when daylight saving time starts", () => {
    const { start, end } = orgLocalDayUtcRange(
      "2026-03-08",
      "America/Edmonton",
    );

    expect(start.toISOString()).toBe("2026-03-08T07:00:00.000Z");
    expect(end.toISOString()).toBe("2026-03-09T06:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(23 * 60 * 60 * 1000);
  });

  it("uses a 25-hour UTC range when daylight saving time ends", () => {
    const { start, end } = orgLocalDayUtcRange(
      "2026-11-01",
      "America/Edmonton",
    );

    expect(start.toISOString()).toBe("2026-11-01T06:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-02T07:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(25 * 60 * 60 * 1000);
  });
});
