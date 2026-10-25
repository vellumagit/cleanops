import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { parseChecklistPaste } from "./checklist-paste";

describe("parseChecklistPaste", () => {
  it("reads Svitlana's deep-clean email into sections, groups and tasks", () => {
    const text = fs.readFileSync(
      path.join(__dirname, "__fixtures__", "svit-deep-clean.txt"),
      "utf8",
    );
    const rows = parseChecklistPaste(text);
    const of = (k: string) => rows.filter((r) => r.kind === k).map((r) => r.title);

    expect(of("section")).toEqual([
      "LIVING AREAS & BEDROOMS",
      "KITCHEN",
      "BATHROOMS",
      "HALLWAYS & STAIRS",
      "EXTRA TOUCHES",
    ]);
    expect(of("subsection")).toEqual([
      "Dusting & Surfaces",
      "Windows & Blinds",
      "Floors & Furniture",
      "Bedrooms",
      "Counters & Surfaces",
      "Appliances",
      "Sink & Fixtures",
      "Toilet",
      "Shower & Tub",
      "Sink & Vanity",
      "Walls, Fixtures & Floors",
      "Stairs",
      "Walls & Doors",
      "General",
    ]);
    // Short tasks that start with a verb stay tasks.
    expect(of("item")).toContain("Wipe baseboards");
    expect(of("item")).toContain("Fold toilet paper");
    expect(of("item")).toHaveLength(66); // 85 lines − 5 sections − 14 groups
    // Order is preserved: the kitchen heading comes right before its first group.
    const k = rows.findIndex((r) => r.title === "KITCHEN");
    expect(rows[k + 1]).toEqual({ title: "Counters & Surfaces", kind: "subsection" });
  });

  it("strips bullets and numbers, and a trailing colon makes a group", () => {
    expect(
      parseChecklistPaste("- Kitchen:\n• Wipe counters\n1. Mop floor\n[ ] Empty bins"),
    ).toEqual([
      { title: "Kitchen", kind: "subsection" },
      { title: "Wipe counters", kind: "item" },
      { title: "Mop floor", kind: "item" },
      { title: "Empty bins", kind: "item" },
    ]);
  });

  it("blank input gives nothing", () => {
    expect(parseChecklistPaste("\n \n")).toEqual([]);
  });
});
