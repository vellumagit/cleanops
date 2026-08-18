import { describe, it, expect } from "vitest";
import {
  parseLifecycle,
  parseLeadStage,
  parseLeadSource,
  isOpenLead,
  isClient,
  canSetStage,
  conversionPatch,
  lostPatch,
  newLeadPatch,
  parseQuickAdd,
  stageLabel,
  sourceLabel,
  DEFAULT_LEAD_SOURCE,
} from "./lead-pipeline";

describe("parseLifecycle", () => {
  it("defaults to client, because this column landed on a live table", () => {
    // 79 existing rows. Anything but 'client' as the fallback empties her
    // client list the morning the migration runs.
    for (const v of [null, undefined, "", "nonsense", 42, {}, []]) {
      expect(parseLifecycle(v)).toBe("client");
    }
  });

  it("reads the two deliberate values", () => {
    expect(parseLifecycle("lead")).toBe("lead");
    expect(parseLifecycle("lost")).toBe("lost");
    expect(parseLifecycle("client")).toBe("client");
  });
});

describe("isOpenLead / isClient", () => {
  it("treats a lost lead as NOT a lead", () => {
    // The rule the whole feature rests on. `lifecycle !== 'client'` would put
    // dead leads back in the working list, which is the bug this guards.
    expect(isOpenLead("lost")).toBe(false);
    expect(isOpenLead("lead")).toBe(true);
    expect(isOpenLead("client")).toBe(false);
  });

  it("treats a lost lead as NOT a client either", () => {
    // They belong in neither list — that's the point of a third value.
    expect(isClient("lost")).toBe(false);
    expect(isClient("lead")).toBe(false);
    expect(isClient("client")).toBe(true);
  });

  it("counts an unwritten row as a client, not a lead", () => {
    expect(isClient(null)).toBe(true);
    expect(isOpenLead(null)).toBe(false);
  });
});

describe("stages", () => {
  it("falls back to new rather than throwing on junk", () => {
    for (const v of [null, undefined, "won", "", 7]) {
      expect(parseLeadStage(v)).toBe("new");
    }
  });

  it("reads the three real stages", () => {
    expect(parseLeadStage("new")).toBe("new");
    expect(parseLeadStage("contacted")).toBe("contacted");
    expect(parseLeadStage("quoted")).toBe("quoted");
  });

  it("only allows stage changes on an open lead", () => {
    expect(canSetStage("lead")).toBe(true);
    expect(canSetStage("client")).toBe(false);
    expect(canSetStage("lost")).toBe(false);
  });

  it("labels every stage", () => {
    expect(stageLabel("new")).toBe("New");
    expect(stageLabel("contacted")).toBe("Contacted");
    expect(stageLabel("quoted")).toBe("Quoted");
  });
});

describe("sources", () => {
  it("defaults a typed-in lead to phone, the uncapturable channel", () => {
    expect(DEFAULT_LEAD_SOURCE).toBe("phone");
  });

  it("falls back to other on junk", () => {
    expect(parseLeadSource("carrier pigeon")).toBe("other");
    expect(parseLeadSource(null)).toBe("other");
  });

  it("labels every source", () => {
    expect(sourceLabel("web_form")).toBe("Website form");
    expect(sourceLabel("phone")).toBe("Phone");
    expect(sourceLabel("referral")).toBe("Referral");
  });
});

describe("patches", () => {
  it("clears the stage on conversion so no residue is left behind", () => {
    expect(conversionPatch()).toEqual({ lifecycle: "client", lead_stage: null });
  });

  it("keeps the stage when lost, for the post-mortem", () => {
    expect(lostPatch()).toEqual({ lifecycle: "lost" });
    expect("lead_stage" in lostPatch()).toBe(false);
  });

  it("starts every new lead at new, whatever the channel", () => {
    expect(newLeadPatch("web_form")).toEqual({
      lifecycle: "lead",
      lead_stage: "new",
      lead_source: "web_form",
    });
    expect(newLeadPatch("phone").lead_stage).toBe("new");
  });
});

describe("parseQuickAdd", () => {
  it("needs only a name", () => {
    const r = parseQuickAdd({ name: "Carmen North" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({
      name: "Carmen North",
      phone: null,
      email: null,
      lead_note: null,
      lead_source: "phone",
    });
  });

  it("rejects a blank or whitespace name", () => {
    for (const n of ["", "   ", null, undefined]) {
      const r = parseQuickAdd({ name: n });
      expect(r.ok).toBe(false);
    }
  });

  it("trims everything and nulls the empties", () => {
    const r = parseQuickAdd({
      name: "  Dana  ",
      phone: "  ",
      email: " dana@example.com ",
      note: "  3 bed, wants biweekly ",
      source: "email",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({
      name: "Dana",
      phone: null,
      email: "dana@example.com",
      lead_note: "3 bed, wants biweekly",
      lead_source: "email",
    });
  });

  it("falls back to other on an unrecognized source rather than refusing", () => {
    const r = parseQuickAdd({ name: "Sam", source: "tiktok" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.lead_source).toBe("other");
  });
});
