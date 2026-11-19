import { describe, expect, it } from "vitest";
import { brandButtonColors } from "./readable-on";

describe("brandButtonColors", () => {
  it("white text on a dark brand colour", () => {
    expect(brandButtonColors("#4f46e5")).toEqual({ backgroundColor: "#4f46e5", color: "#ffffff", borderColor: "#4f46e5" });
  });

  it("a white brand colour gets dark text and a visible edge, not a blank rectangle", () => {
    expect(brandButtonColors("#ffffff")).toEqual({ backgroundColor: "#ffffff", color: "#111827", borderColor: "#9ca3af" });
    expect(brandButtonColors("#FFF").color).toBe("#111827");
  });

  it("a pale yellow gets dark text", () => {
    expect(brandButtonColors("#fde047").color).toBe("#111827");
  });

  it("something that isn't a colour falls back to the default", () => {
    for (const bad of [null, undefined, "", "white", "rgb(1,2,3)", "#12345"]) {
      expect(brandButtonColors(bad)).toEqual({ backgroundColor: "#4f46e5", color: "#ffffff", borderColor: "#4f46e5" });
    }
  });
});
