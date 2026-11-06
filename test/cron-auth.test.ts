/**
 * Every cron route authorizes through requireCronAuth, and requireCronAuth
 * is where background work starts failing closed (supabase/query-guard.ts).
 * So: the guard must enter the scope for the rest of the handler, and no
 * cron route may skip it.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requireCronAuth } from "@/lib/cron-auth";
import { inFailClosedScope } from "@/lib/supabase/query-guard";

const SECRET = "a-cron-secret-long-enough-to-pass";
const req = (auth?: string) => new Request("https://sollos3.com/api/cron/x", { headers: auth ? { authorization: auth } : {} });

afterEach(() => vi.unstubAllEnvs());

describe("requireCronAuth", () => {
  it("refuses when the secret is missing or short, and when the header is wrong", () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(requireCronAuth(req(`Bearer ${SECRET}`))?.status).toBe(503);
    vi.stubEnv("CRON_SECRET", SECRET);
    expect(requireCronAuth(req("Bearer nope"))?.status).toBe(401);
    expect(requireCronAuth(req())?.status).toBe(401);
  });

  it("once authorized, the rest of the handler runs fail-closed", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    // A handler shaped like every cron route: auth first, then awaited work.
    const handler = async () => {
      const unauthorized = requireCronAuth(req(`Bearer ${SECRET}`));
      if (unauthorized) return "refused";
      await Promise.resolve();
      return inFailClosedScope() ? "fail-closed" : "fail-open";
    };
    expect(await handler()).toBe("fail-closed");
  });
});

describe("every cron route", () => {
  it("calls requireCronAuth", () => {
    const dir = join(__dirname, "..", "src", "app", "api", "cron");
    const missing = readdirSync(dir).filter((name) => {
      const text = readFileSync(join(dir, name, "route.ts"), "utf8");
      return !/requireCronAuth\(/.test(text);
    });
    expect(missing).toEqual([]);
  });
});
