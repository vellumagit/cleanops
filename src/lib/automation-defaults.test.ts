import { describe, it, expect } from "vitest";
import { resolveAutomationEnabled } from "./automation-defaults";

/**
 * Automations are OPT-IN. This is a policy that must not silently regress —
 * a default flipping back to "on" would start emailing/texting real clients on
 * behalf of orgs that never asked for it.
 */
describe("resolveAutomationEnabled — everything is opt-in", () => {
  it("is OFF when no setting exists", () => {
    expect(resolveAutomationEnabled(null, "booking_confirmation_email")).toBe(false);
    expect(resolveAutomationEnabled({}, "invoice_overdue_reminder")).toBe(false);
    expect(resolveAutomationEnabled(undefined, "auto_invoice_on_job_complete")).toBe(false);
  });

  it("is OFF for a key that used to default ON before the opt-in flip", () => {
    // These were previously default-on; the grandfather migration wrote them
    // explicitly for existing orgs, so absent = off is now correct.
    for (const key of [
      "auto_complete_past_bookings",
      "employee_daily_schedule",
      "review_request_after_completion",
      "invoice_paid_receipt",
    ]) {
      expect(resolveAutomationEnabled({}, key)).toBe(false);
    }
  });

  it("respects an explicit true", () => {
    expect(
      resolveAutomationEnabled({ booking_confirmation_email: { enabled: true } }, "booking_confirmation_email"),
    ).toBe(true);
  });

  it("respects an explicit false", () => {
    expect(
      resolveAutomationEnabled({ booking_confirmation_email: { enabled: false } }, "booking_confirmation_email"),
    ).toBe(false);
  });

  it("a malformed/partial entry is treated as off, never on", () => {
    expect(resolveAutomationEnabled({ x: {} }, "x")).toBe(false);
    expect(
      resolveAutomationEnabled(
        { x: { enabled: undefined } } as Record<string, { enabled?: boolean }>,
        "x",
      ),
    ).toBe(false);
  });

  it("one key being on does not enable a different key", () => {
    const settings = { booking_confirmation_email: { enabled: true } };
    expect(resolveAutomationEnabled(settings, "booking_confirmation_sms")).toBe(false);
  });
});
