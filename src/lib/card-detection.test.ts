import { describe, it, expect } from "vitest";
import { detectCardNumber, luhnCheck } from "./card-detection";

/**
 * Regression suite for the booking-notes false-positive incident.
 *
 * The original scanner skipped every whitespace/hyphen/period, merging every
 * number in a notes field into one long digit run, then Luhn-tested each
 * 13-19 digit sub-window of it (~21 overlapping candidates → ~89% false
 * positives). Because `notes` is validated with `.refine(noCardNumber)`, a
 * false positive rejected the WHOLE booking form save — an owner typing
 * "Gate 4521 Alarm 5678 Lockbox 3344" silently lost their edit.
 *
 * These tests pin both directions: ordinary notes must save, real PANs must not.
 */

describe("detectCardNumber — must NOT flag ordinary notes", () => {
  const legitimate = [
    "Gate code 4521\nAlarm 5678\nCall 780-555-0199 if no answer",
    "4521 5678 0199 3344",
    "07-21-2026 780-555-0199",
    "INV 100234 - 2026.07.21 - 450.00",
    "Suite 1204. Lockbox code 8891. Parking stall 32.",
    "1. vacuum all floors\n2. wash all floors\n3. clean bathroom",
    "Please focus on the kitchen and bathrooms. Dog is friendly.",
    "",
  ];
  for (const note of legitimate) {
    it(`allows ${JSON.stringify(note.slice(0, 40))}`, () => {
      expect(detectCardNumber(note)).toBeNull();
    });
  }

  it("does not carve a card-shaped slice out of a longer id number", () => {
    // 20 contiguous digits is not a PAN — the run must itself be 13-19 long.
    expect(detectCardNumber("ref 42424242424242424242")).toBeNull();
  });
});

describe("detectCardNumber — must still catch real PANs", () => {
  const cards: Array<[string, string]> = [
    ["4242424242424242", "4242"], // Visa, contiguous
    ["4242 4242 4242 4242", "4242"], // Visa, space-grouped
    ["4242-4242-4242-4242", "4242"], // Visa, hyphen-grouped
    ["card 5555555555554444 exp 12/28", "4444"], // Mastercard, embedded
    ["378282246310005", "0005"], // Amex (15)
    ["6011111111111117", "1117"], // Discover
    ["my visa is 4012888888881881 ok", "1881"], // embedded in prose
  ];
  for (const [input, lastFour] of cards) {
    it(`blocks ${JSON.stringify(input.slice(0, 40))}`, () => {
      const hit = detectCardNumber(input);
      expect(hit).not.toBeNull();
      expect(hit!.lastFour).toBe(lastFour);
    });
  }
});

describe("luhnCheck", () => {
  it("accepts a valid PAN and rejects a tampered one", () => {
    expect(luhnCheck("4242424242424242")).toBe(true);
    expect(luhnCheck("4242424242424243")).toBe(false);
  });
  it("rejects out-of-range lengths", () => {
    expect(luhnCheck("424242424242")).toBe(false); // 12
    expect(luhnCheck("42424242424242424242")).toBe(false); // 20
  });
});
