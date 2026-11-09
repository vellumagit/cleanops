import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ from: mocks.from }),
}));

vi.mock("@/lib/crypto", () => ({
  decryptSecret: () => "access-token",
  encryptSecret: () => "encrypted-token",
}));

const { createMemberCalendarEvent, updateMemberCalendarEvent } = await import(
  "@/lib/google-calendar"
);

function query(result: { data: unknown; error: { message: string } | null }) {
  const builder: Record<string, (...args: unknown[]) => unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(async () => result);
  return builder;
}

const booking = {
  id: "booking-1",
  scheduled_at: "2026-11-10T16:00:00.000Z",
  duration_minutes: 60,
  service_type: "cleaning",
  address: null,
  notes: null,
};

describe("member calendar event mapping reads", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let errorLog: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "new-event" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.from.mockImplementation((table: string) =>
      table === "integration_connections"
        ? query({
            data: {
              id: "connection-1",
              access_token_ciphertext: "encrypted-token",
              refresh_token_ciphertext: null,
              token_expires_at: null,
              metadata: {},
            },
            error: null,
          })
        : query({ data: null, error: { message: "connection reset" } }),
    );
  });

  afterEach(() => {
    errorLog.mockRestore();
    vi.unstubAllGlobals();
  });

  it("does not create a replacement if the prior mapping read fails", async () => {
    await expect(
      createMemberCalendarEvent("member-create", booking),
    ).resolves.toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith(
      "[gcal/member] Failed to read prior event mapping:",
      booking.id,
      "member-create",
      { message: "connection reset" },
    );
  });

  it("does not treat a failed mapping read as a missing event during update", async () => {
    await expect(
      updateMemberCalendarEvent("member-update", booking),
    ).resolves.toBe(false);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith(
      "[gcal/member] Failed to read event mapping before update:",
      booking.id,
      "member-update",
      { message: "connection reset" },
    );
  });
});
