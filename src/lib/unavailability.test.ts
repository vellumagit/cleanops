import { describe, it, expect } from "vitest";
import {
  buildUnavailabilityNotice,
  crewOffOnJob,
  formatDayRange,
} from "./unavailability";

describe("formatDayRange", () => {
  it("one day reads as one day, a range as a range", () => {
    expect(formatDayRange("2026-10-12", "2026-10-12")).toBe("Mon, Oct 12");
    expect(formatDayRange("2026-10-12", "2026-10-14")).toBe(
      "Mon, Oct 12 – Wed, Oct 14",
    );
  });
});

describe("buildUnavailabilityNotice", () => {
  it("a time-off request with jobs on it says they need cover", () => {
    const n = buildUnavailabilityNotice({
      kind: "time_off_request",
      name: "Olha",
      startDate: "2026-10-12",
      endDate: "2026-10-14",
      bookedJobs: 2,
    });
    expect(n.title).toBe("Time-off request");
    expect(n.body).toBe(
      "Olha asked for time off Mon, Oct 12 – Wed, Oct 14. Already on 2 jobs in that window — they'll need cover if you approve.",
    );
  });

  it("a request with nothing booked is just a heads-up", () => {
    const n = buildUnavailabilityNotice({
      kind: "time_off_request",
      name: "Olha",
      startDate: "2026-10-12",
      endDate: "2026-10-12",
      bookedJobs: 0,
    });
    expect(n.body).toBe(
      "Olha asked for time off Mon, Oct 12. Nothing is booked for them then.",
    );
  });

  it("a day marked unavailable with one job on it", () => {
    const n = buildUnavailabilityNotice({
      kind: "day_off",
      name: "Olha",
      startDate: "2026-10-12",
      endDate: "2026-10-12",
      bookedJobs: 1,
    });
    expect(n.title).toBe("Marked unavailable");
    expect(n.body).toBe(
      "Olha marked themselves unavailable Mon, Oct 12. Already on 1 job that day — it needs cover.",
    );
  });
});

describe("crewOffOnJob", () => {
  it("returns only the crew members off on their day", () => {
    expect(
      crewOffOnJob(["a", "b", "c"], { a: ["2026-10-12"], b: ["2026-10-13"] }, () =>
        "2026-10-12",
      ),
    ).toEqual(["a"]);
  });
});
