import { describe, it, expect } from "vitest";
import { normalizePhone, isE164 } from "./phone";

describe("normalizePhone", () => {
  it("keeps a well-formed E.164 number, stripping formatting", () => {
    expect(normalizePhone("+1 (555) 123-4567")).toBe("+15551234567");
    expect(normalizePhone("+15551234567")).toBe("+15551234567");
  });

  it("adds +1 to a bare 10-digit NANP number", () => {
    expect(normalizePhone("5551234567")).toBe("+15551234567");
    expect(normalizePhone("(555) 123-4567")).toBe("+15551234567");
  });

  it("prefixes + to an 11-digit number with leading 1", () => {
    expect(normalizePhone("15551234567")).toBe("+15551234567");
  });

  it("leaves ambiguous input unchanged", () => {
    expect(normalizePhone("12345")).toBe("12345");
    expect(normalizePhone("")).toBe("");
  });
});

describe("isE164", () => {
  it("accepts + followed by 7-15 digits", () => {
    expect(isE164("+15551234567")).toBe(true);
    expect(isE164("+441134960000")).toBe(true);
  });

  it("rejects missing +, letters, or out-of-range length", () => {
    expect(isE164("5551234567")).toBe(false);
    expect(isE164("+abc")).toBe(false);
    expect(isE164("+123")).toBe(false); // too short (<7)
    expect(isE164("+1234567890123456")).toBe(false); // too long (>15)
    expect(isE164("")).toBe(false);
  });
});
