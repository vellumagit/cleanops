import { describe, expect, it } from "vitest";
import { RESERVED_NAMES, nameProblem, publicPrice, tidyName } from "./booking-page-rules";

describe("the link name", () => {
  it("what someone types is tidied into something a link can carry", () => {
    expect(tidyName("Svit Cleaning Co.")).toBe("svit-cleaning-co");
    expect(tidyName("  Bright & Clean  ")).toBe("bright-and-clean");
    expect(tidyName("Ménage Élite")).toBe("menage-elite");
    expect(tidyName("A--B__C")).toBe("a-b-c");
    expect(tidyName("---")).toBe("");
    expect(tidyName("")).toBe("");
    // Cut to length without leaving a hyphen on the end.
    const long = tidyName(`${"a".repeat(59)} b c`);
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith("-")).toBe(false);
  });

  it("is refused, in words, when it is empty, too short, malformed or reserved", () => {
    expect(nameProblem("")).toBe("Type a name for your link.");
    expect(nameProblem("ab")).toMatch(/at least 3/);
    expect(nameProblem("a".repeat(61))).toMatch(/60 characters/);
    for (const bad of ["-svit", "svit-", "Svit", "svit cleaning", "svit/clean", "svit.co"]) {
      expect(nameProblem(bad), bad).toMatch(/letters, numbers and hyphens/);
    }
    for (const word of ["admin", "sollos", "book", "login", "api", "www"]) {
      expect(RESERVED_NAMES.has(word)).toBe(true);
      expect(nameProblem(word), word).toMatch(/can't be used as a link name/);
    }
  });

  it("a normal company name is fine, and a tidied name always passes or is empty", () => {
    for (const ok of ["svit", "svit-cleaning-co", "bright-and-clean", "a1b", "2-sisters"]) expect(nameProblem(ok), ok).toBeNull();
    for (const raw of ["Svit Cleaning Co.", "Ménage Élite", "  2 Sisters!  ", "Maid 4 U"]) {
      expect(nameProblem(tidyName(raw)), raw).toBeNull();
    }
  });
});

describe("how a service's price shows", () => {
  const money = (c: number) => `$${(c / 100).toFixed(2)}`;
  it("fixed shows it, from says From, hidden shows nothing", () => {
    expect(publicPrice("fixed", 15000, money)).toBe("$150.00");
    expect(publicPrice("from", 15000, money)).toBe("From $150.00");
    expect(publicPrice("hidden", 15000, money)).toBeNull();
  });
  it("a service with no price shows none, whatever the choice", () => {
    for (const mode of ["fixed", "from", "hidden"] as const) {
      expect(publicPrice(mode, null, money)).toBeNull();
      expect(publicPrice(mode, 0, money)).toBeNull();
      expect(publicPrice(mode, undefined, money)).toBeNull();
    }
  });
});
