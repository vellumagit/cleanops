import { describe, it, expect } from "vitest";
import { classifyOAuthState } from "./oauth-state";

const now = new Date("2026-07-29T16:30:00.000Z");
const iso = (offsetMinutes: number) =>
  new Date(now.getTime() + offsetMinutes * 60_000).toISOString();

describe("classifyOAuthState", () => {
  it("claims a fresh, unconsumed token", () => {
    expect(
      classifyOAuthState({ expires_at: iso(5), consumed_at: null }, now),
    ).toBe("claimable");
  });

  it("expires an unconsumed token past its TTL", () => {
    expect(
      classifyOAuthState({ expires_at: iso(-1), consumed_at: null }, now),
    ).toBe("expired");
  });

  it("reports a consumed token as a replay", () => {
    expect(
      classifyOAuthState(
        { expires_at: iso(5), consumed_at: iso(-1) },
        now,
      ),
    ).toBe("replayed");
  });

  // The regression this module exists for: a duplicate callback (prefetch,
  // refresh, back-navigation) can land after the 10-minute TTL. It is still a
  // replay of a handshake that SUCCEEDED — reporting "expired, try again"
  // would send a user whose Sage connection worked back through the flow.
  it("prefers replay over expiry when a consumed token is also past its TTL", () => {
    expect(
      classifyOAuthState(
        { expires_at: iso(-20), consumed_at: iso(-19) },
        now,
      ),
    ).toBe("replayed");
  });

  it("treats an exactly-at-expiry token as still claimable", () => {
    expect(
      classifyOAuthState({ expires_at: now.toISOString(), consumed_at: null }, now),
    ).toBe("claimable");
  });
});
