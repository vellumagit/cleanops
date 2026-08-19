import { describe, it, expect } from "vitest";
import {
  parseTippingSettings,
  mergeTippingSettings,
  normalizeTipInstructions,
  tippingSettingsFromForm,
  tipPresetAmounts,
  normalizeTipCents,
  splitTipByMinutes,
  MAX_TIP_CENTS,
  TIPPING_DEFAULT,
} from "./tip-split";

describe("parseTippingSettings", () => {
  it("is OFF when the column has never been written", () => {
    // The whole point: an owner who has never touched this setting must not
    // find a tip prompt on invoices their clients already received.
    expect(parseTippingSettings(null).enabled).toBe(false);
    expect(parseTippingSettings(undefined).enabled).toBe(false);
  });

  it("survives junk in a hand-editable JSONB column", () => {
    // A public invoice page a client is trying to PAY must not 500 because
    // someone fat-fingered the settings row.
    for (const junk of ["nope", 42, [], [1, 2, 3], { presets: "15,18" }]) {
      const s = parseTippingSettings(junk);
      expect(s.enabled).toBe(false);
      expect(s.presets.length).toBeGreaterThan(0);
    }
  });

  it("keeps enabled true with sane presets", () => {
    expect(parseTippingSettings({ enabled: true, presets: [10, 15, 20] })).toEqual(
      { enabled: true, presets: [10, 15, 20], instructions: null },
    );
  });

  it("sorts, dedupes and caps the preset list", () => {
    const s = parseTippingSettings({
      enabled: true,
      presets: [20, 15, 15, 10, 25, 30],
    });
    expect(s.presets).toEqual([10, 15, 20, 25]);
  });

  it("drops out-of-range percentages", () => {
    const s = parseTippingSettings({
      enabled: true,
      presets: [0, -5, 15, 101, 999],
    });
    expect(s.presets).toEqual([15]);
  });

  it("falls back to defaults rather than showing an empty prompt", () => {
    const s = parseTippingSettings({ enabled: true, presets: [0, -1] });
    expect(s.enabled).toBe(true);
    expect(s.presets).toEqual(TIPPING_DEFAULT.presets);
  });

  it("round-trips the settings form", () => {
    expect(tippingSettingsFromForm(true, ["18", "20", "25"])).toEqual({
      enabled: true,
      presets: [18, 20, 25],
      instructions: null,
    });
    expect(tippingSettingsFromForm(false, ["18"]).enabled).toBe(false);
  });
});

describe("tipPresetAmounts", () => {
  it("computes percentages of the outstanding balance", () => {
    expect(tipPresetAmounts(10_000, [15, 18, 20])).toEqual([
      { percent: 15, cents: 1500 },
      { percent: 18, cents: 1800 },
      { percent: 20, cents: 2000 },
    ]);
  });

  it("rounds to the cent", () => {
    // $123.45 at 18% = $22.221
    expect(tipPresetAmounts(12_345, [18])).toEqual([
      { percent: 18, cents: 2222 },
    ]);
  });

  it("never offers a button that would charge nothing", () => {
    expect(tipPresetAmounts(2, [15])).toEqual([{ percent: 15, cents: 1 }]);
  });

  it("offers nothing on a settled invoice", () => {
    expect(tipPresetAmounts(0, [15, 20])).toEqual([]);
    expect(tipPresetAmounts(-500, [15])).toEqual([]);
  });
});

describe("normalizeTipCents", () => {
  it("treats absent, zero and negative as no tip", () => {
    for (const v of [null, undefined, "", 0, -1, "abc", NaN]) {
      expect(normalizeTipCents(v)).toBeNull();
    }
  });

  it("accepts a normal tip", () => {
    expect(normalizeTipCents("1500")).toBe(1500);
    expect(normalizeTipCents(2000)).toBe(2000);
  });

  it("caps a fat-fingered amount instead of charging it", () => {
    expect(normalizeTipCents(99_999_999)).toBe(MAX_TIP_CENTS);
  });
});

describe("splitTipByMinutes", () => {
  it("gives the whole tip to a lone cleaner", () => {
    expect(splitTipByMinutes(2000, [{ membershipId: "a", minutes: 180 }])).toEqual(
      [{ membershipId: "a", amountCents: 2000, shareMinutes: 180 }],
    );
  });

  it("splits evenly when the minutes are equal", () => {
    const out = splitTipByMinutes(2000, [
      { membershipId: "a", minutes: 120 },
      { membershipId: "b", minutes: 120 },
    ]);
    expect(out.map((a) => a.amountCents)).toEqual([1000, 1000]);
  });

  it("weights by minutes worked", () => {
    // 3 hours vs 1 hour on a $20 tip -> $15 / $5.
    const out = splitTipByMinutes(2000, [
      { membershipId: "a", minutes: 180 },
      { membershipId: "b", minutes: 60 },
    ]);
    expect(out).toEqual([
      { membershipId: "a", amountCents: 1500, shareMinutes: 180 },
      { membershipId: "b", amountCents: 500, shareMinutes: 60 },
    ]);
  });

  it("loses no cent to rounding on a three-way split", () => {
    // THE bug this function exists to prevent: $10 / 3 rounds to 3.33 each,
    // which is 9.99 — a cent short, silently, on every single split.
    const out = splitTipByMinutes(1000, [
      { membershipId: "a", minutes: 60 },
      { membershipId: "b", minutes: 60 },
      { membershipId: "c", minutes: 60 },
    ]);
    expect(out.reduce((s, a) => s + a.amountCents, 0)).toBe(1000);
    expect(out.map((a) => a.amountCents).sort()).toEqual([333, 333, 334]);
  });

  it("always sums to exactly the tip, across many awkward splits", () => {
    for (const tip of [1, 2, 7, 99, 101, 1000, 1234, 5555, 99_999]) {
      for (const crew of [2, 3, 4, 5, 7]) {
        const shares = Array.from({ length: crew }, (_, i) => ({
          membershipId: `m${i}`,
          // Deliberately uneven minutes — even splits hide remainder bugs.
          minutes: 30 + i * 17,
        }));
        const out = splitTipByMinutes(tip, shares);
        expect(out.reduce((s, a) => s + a.amountCents, 0)).toBe(tip);
      }
    }
  });

  it("is deterministic — the same input never reshuffles", () => {
    const shares = [
      { membershipId: "zed", minutes: 100 },
      { membershipId: "amy", minutes: 100 },
      { membershipId: "bob", minutes: 100 },
    ];
    const first = splitTipByMinutes(1000, shares);
    for (let i = 0; i < 5; i += 1) {
      expect(splitTipByMinutes(1000, shares)).toEqual(first);
    }
  });

  it("ignores people who worked nothing", () => {
    const out = splitTipByMinutes(1000, [
      { membershipId: "a", minutes: 120 },
      { membershipId: "b", minutes: 0 },
    ]);
    expect(out).toEqual([
      { membershipId: "a", amountCents: 1000, shareMinutes: 120 },
    ]);
  });

  it("returns empty when nobody can be credited, rather than inventing one", () => {
    // Caller records the tip unattributed — the money was still paid.
    expect(splitTipByMinutes(1000, [])).toEqual([]);
    expect(
      splitTipByMinutes(1000, [{ membershipId: "a", minutes: 0 }]),
    ).toEqual([]);
    expect(splitTipByMinutes(1000, [{ membershipId: "", minutes: 60 }])).toEqual(
      [],
    );
  });

  it("hands a tiny tip to a subset instead of paying anyone zero", () => {
    // 2 cents across 5 cleaners: two get a cent, nobody gets a $0 IOU.
    const out = splitTipByMinutes(
      2,
      Array.from({ length: 5 }, (_, i) => ({
        membershipId: `m${i}`,
        minutes: 60,
      })),
    );
    expect(out).toHaveLength(2);
    expect(out.reduce((s, a) => s + a.amountCents, 0)).toBe(2);
  });

  it("treats a zero or negative tip as no tip", () => {
    expect(splitTipByMinutes(0, [{ membershipId: "a", minutes: 60 }])).toEqual(
      [],
    );
    expect(splitTipByMinutes(-500, [{ membershipId: "a", minutes: 60 }])).toEqual(
      [],
    );
  });
});

describe("instructions, and the two forms that share one column", () => {
  it("reads and trims the public blurb", () => {
    expect(
      parseTippingSettings({ enabled: true, instructions: "  Add 15% please " })
        .instructions,
    ).toBe("Add 15% please");
  });

  it("treats blank or non-string as no instructions", () => {
    for (const v of ["", "   ", 42, null, {}]) {
      expect(parseTippingSettings({ instructions: v }).instructions).toBeNull();
    }
  });

  it("saving the TOGGLE does not wipe the instructions", () => {
    // The whole reason mergeTippingSettings exists. Settings › Invoicing owns
    // enabled+presets; Settings › Payment instructions owns the wording. Either
    // writing the object wholesale would silently erase the other's field.
    const stored = {
      enabled: false,
      presets: [15],
      instructions: "E-transfer any extra and we'll pass it to your cleaner.",
    };
    const after = tippingSettingsFromForm(true, ["18", "20"], stored);
    expect(after.enabled).toBe(true);
    expect(after.presets).toEqual([18, 20]);
    expect(after.instructions).toBe(stored.instructions);
  });

  it("saving the INSTRUCTIONS does not wipe the toggle or presets", () => {
    const stored = { enabled: true, presets: [10, 25], instructions: null };
    const after = mergeTippingSettings(stored, { instructions: "Cash is fine." });
    expect(after.enabled).toBe(true);
    expect(after.presets).toEqual([10, 25]);
    expect(after.instructions).toBe("Cash is fine.");
  });

  it("merging onto a never-written column still yields safe defaults", () => {
    const after = mergeTippingSettings(null, { instructions: "Thanks!" });
    expect(after.enabled).toBe(false);
    expect(after.instructions).toBe("Thanks!");
  });

  it("caps a runaway blurb — this sits on an invoice, not a brochure", () => {
    expect(normalizeTipInstructions("x".repeat(900))).toHaveLength(500);
    expect(normalizeTipInstructions("   ")).toBeNull();
    expect(normalizeTipInstructions(null)).toBeNull();
  });
});
