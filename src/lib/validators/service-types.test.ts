import { describe, it, expect } from "vitest";
import { ServiceTypeRowSchema, SERVICE_DESCRIPTION_MAX } from "./service-types";

const base = { name: "Deep clean", category: "residential", default_duration_minutes: "240" };

describe("service description length", () => {
  it("takes Svitlana's ~4,000-character deep-clean list", () => {
    const r = ServiceTypeRowSchema.safeParse({ ...base, description: "x".repeat(4000) });
    const descErr = r.success ? undefined : r.error.issues.find((i) => i.path[0] === "description");
    expect(descErr).toBeUndefined();
  });

  it("still stops past the limit", () => {
    const r = ServiceTypeRowSchema.safeParse({ ...base, description: "x".repeat(SERVICE_DESCRIPTION_MAX + 1) });
    expect(r.success ? undefined : r.error.issues.find((i) => i.path[0] === "description")).toBeDefined();
  });
});
