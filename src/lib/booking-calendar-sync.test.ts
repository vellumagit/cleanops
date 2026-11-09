import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  createCalendarEvent: vi.fn(),
  updateCalendarEvent: vi.fn(),
  syncMemberCalendarEvents: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ from: mocks.from }),
}));

vi.mock("@/lib/google-calendar", () => ({
  createCalendarEvent: mocks.createCalendarEvent,
  updateCalendarEvent: mocks.updateCalendarEvent,
  syncMemberCalendarEvents: mocks.syncMemberCalendarEvents,
}));

const { resyncBookingCalendars } = await import("@/lib/booking-calendar-sync");

function query(result: { data: unknown; error: { message: string } | null }) {
  const builder: Record<string, (...args: unknown[]) => unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(async () => result);
  Object.assign(builder, {
    then: (resolve: (value: typeof result) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  });
  return builder;
}

const booking = {
  id: "booking-1",
  organization_id: "org-1",
  status: "confirmed",
  archived_at: null,
  scheduled_at: "2026-11-10T16:00:00.000Z",
  duration_minutes: 60,
  service_type: "cleaning",
  address: null,
  notes: null,
  assigned_to: "member-1",
  google_calendar_event_id: null,
  splits: null,
  client: null,
  assignee: null,
};

describe("resyncBookingCalendars", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports a booking lookup error instead of treating it as a missing booking", async () => {
    mocks.from.mockReturnValue(query({
      data: null,
      error: { message: "connection reset" },
    }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(resyncBookingCalendars("booking-1")).resolves.toEqual({
      org: "failed",
      members: false,
    });

    expect(error).toHaveBeenCalledWith(
      "[gcal] resync booking lookup failed:",
      "booking-1",
      { message: "connection reset" },
    );
    expect(mocks.syncMemberCalendarEvents).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("aborts both calendar syncs if the crew lookup fails", async () => {
    mocks.from.mockImplementation((table: string) =>
      table === "bookings"
        ? query({ data: booking, error: null })
        : query({ data: null, error: { message: "connection reset" } }),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(resyncBookingCalendars("booking-1")).resolves.toEqual({
      org: "failed",
      members: false,
    });

    expect(error).toHaveBeenCalledWith(
      "[gcal] resync crew lookup failed; skipping calendars:",
      "booking-1",
      { message: "connection reset" },
    );
    expect(mocks.createCalendarEvent).not.toHaveBeenCalled();
    expect(mocks.updateCalendarEvent).not.toHaveBeenCalled();
    expect(mocks.syncMemberCalendarEvents).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
