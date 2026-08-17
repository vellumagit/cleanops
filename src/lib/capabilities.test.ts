import { describe, expect, it } from "vitest";
import {
  CAPABILITY_KEYS,
  capabilitiesFromForm,
  grantedCapabilities,
  hasCapability,
  isRestricted,
  parseCapabilities,
} from "@/lib/capabilities";

describe("owners and admins are never restricted", () => {
  it("has everything even when the column says otherwise", () => {
    // Someone unticking boxes on an owner must not be able to lock the
    // business out of its own books.
    const denied = { scheduling: false, invoicing: false } as const;
    for (const role of ["owner", "admin"]) {
      for (const key of CAPABILITY_KEYS) {
        expect(hasCapability(role, denied, key)).toBe(true);
      }
      expect(isRestricted(role, denied)).toBe(false);
    }
  });
});

describe("employees have none of these", () => {
  it("is false regardless of what is stored", () => {
    const granted = { scheduling: true, invoicing: true } as const;
    for (const key of CAPABILITY_KEYS) {
      expect(hasCapability("employee", granted, key)).toBe(false);
    }
  });

  it("treats an unknown or missing role as no access", () => {
    expect(hasCapability(null, null, "scheduling")).toBe(false);
    expect(hasCapability("cleaner", null, "scheduling")).toBe(false);
  });
});

describe("a manager nobody has configured keeps working", () => {
  it("NULL means unrestricted — the state every existing manager is in", () => {
    for (const key of CAPABILITY_KEYS) {
      expect(hasCapability("manager", null, key)).toBe(true);
    }
    expect(isRestricted("manager", null)).toBe(false);
  });

  it("a capability added AFTER they were set up is granted, not revoked", () => {
    // Only 'scheduling' was ever decided; the rest must not silently vanish
    // the day a new key ships.
    const partial = { scheduling: true };
    expect(hasCapability("manager", partial, "invoicing")).toBe(true);
    expect(hasCapability("manager", partial, "timesheets")).toBe(true);
  });
});

describe("a manager who has been narrowed", () => {
  const olha = {
    scheduling: true,
    timesheets: true,
    invoicing: false,
    clients: true,
    subcontractors: false,
  };

  it("keeps what was granted", () => {
    expect(hasCapability("manager", olha, "scheduling")).toBe(true);
    expect(hasCapability("manager", olha, "timesheets")).toBe(true);
  });

  it("loses only what was explicitly switched off", () => {
    expect(hasCapability("manager", olha, "invoicing")).toBe(false);
    expect(hasCapability("manager", olha, "subcontractors")).toBe(false);
  });

  it("reports the granted set for menus", () => {
    expect(grantedCapabilities("manager", olha)).toEqual([
      "scheduling",
      "timesheets",
      "clients",
    ]);
  });

  it("is recognisably restricted, unlike a fresh manager", () => {
    expect(isRestricted("manager", olha)).toBe(true);
    expect(isRestricted("manager", null)).toBe(false);
  });
});

describe("parseCapabilities survives whatever is in the JSONB column", () => {
  it("keeps known boolean keys", () => {
    expect(parseCapabilities({ scheduling: false, invoicing: true })).toEqual({
      scheduling: false,
      invoicing: true,
    });
  });

  it("discards unknown keys and non-booleans", () => {
    expect(
      parseCapabilities({
        scheduling: "yes",
        payroll: true,
        invoicing: false,
        nested: { a: 1 },
      }),
    ).toEqual({ invoicing: false });
  });

  it("returns null for shapes that mean nothing", () => {
    for (const raw of [null, undefined, [], "scheduling", 7, {}]) {
      expect(parseCapabilities(raw)).toBeNull();
    }
  });

  it("a parsed empty object behaves as unrestricted, not as locked out", () => {
    const parsed = parseCapabilities({ unrelated: true });
    expect(parsed).toBeNull();
    expect(hasCapability("manager", parsed, "invoicing")).toBe(true);
  });
});

describe("capabilitiesFromForm writes an explicit decision for every key", () => {
  it("records both the ticked and the unticked", () => {
    const saved = capabilitiesFromForm(["scheduling", "timesheets"]);
    expect(saved).toEqual({
      scheduling: true,
      timesheets: true,
      invoicing: false,
      clients: false,
      subcontractors: false,
    });
  });

  it("unticking everything is a real state, not an accidental reset", () => {
    const saved = capabilitiesFromForm([]);
    expect(hasCapability("manager", saved, "scheduling")).toBe(false);
    expect(isRestricted("manager", saved)).toBe(true);
  });

  it("ignores keys that aren't capabilities", () => {
    const saved = capabilitiesFromForm(["scheduling", "payroll", "drop table"]);
    expect(Object.keys(saved ?? {}).sort()).toEqual([...CAPABILITY_KEYS].sort());
  });
});
