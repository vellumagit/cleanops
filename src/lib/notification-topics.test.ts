import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OFFICE_TOPICS, alertsFor, isOfficeTopic, mutedTopicsPrefs, readMutedTopics } from "./notification-topics";

describe("reading someone's choices", () => {
  it("nothing saved, or something unreadable, mutes nothing", () => {
    for (const prefs of [undefined, null, {}, [], "money", 7, { muted_topics: "money" }, { muted_topics: null }]) {
      expect([...readMutedTopics(prefs)], JSON.stringify(prefs)).toEqual([]);
    }
  });

  it("keeps the topics it knows and drops the rest", () => {
    expect([...readMutedTopics({ muted_topics: ["money", "nonsense", 3, "clients"] })].sort()).toEqual(["clients", "money"]);
  });

  it("stores known topics once, in the app's own order", () => {
    expect(mutedTopicsPrefs(["team", "money", "money", "made_up", "schedule"])).toEqual({ muted_topics: ["schedule", "money", "team"] });
    expect(mutedTopicsPrefs([])).toEqual({ muted_topics: [] });
  });

  it("a notice with no topic always alerts; one with a topic alerts unless that topic is muted", () => {
    const prefs = { muted_topics: ["money"] };
    expect(alertsFor(prefs, undefined)).toBe(true);
    expect(alertsFor(prefs, "money")).toBe(false);
    expect(alertsFor(prefs, "clients")).toBe(true);
    expect(alertsFor({}, "money")).toBe(true);
  });
});

/**
 * Every notice sent to the office by role is either sorted into a topic or
 * is on the short list of ones that must always alert. A new one added
 * without thinking about it fails here, with the file and line.
 */
describe("every office notice is sorted", () => {
  // Deliberately always on. file → how many unsorted office notices it may hold.
  const ALWAYS_ON: Record<string, number> = {
    // The sender itself: the type and the two switch arms.
    "src/lib/notify.ts": 0,
    // Stopped until a person acts.
    "src/lib/google-calendar.ts": 1, // calendar disconnected
    "src/lib/invoice-send.ts": 2, // an invoice couldn't auto-send
    "src/lib/sms.ts": 1, // texting paused at the monthly limit
    // In-app only (push is off there); one combined push follows it.
    "src/lib/automations.ts": 1, // stale estimate
  };

  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(path);
    }
  };
  walk("src");

  it("no office notice is left without a topic by accident", () => {
    const unsorted: Record<string, string[]> = {};
    for (const file of files) {
      const rel = file.replace(/\\/g, "/");
      if (rel === "src/lib/notify.ts") continue;
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, i) => {
        if (!/audience: "org-(management|admins)"/.test(line)) return;
        // The topic sits beside the audience, or is passed on the same line.
        const near = lines.slice(Math.max(0, i - 1), i + 4).join("\n");
        if (/\btopic\b/.test(near)) return;
        (unsorted[rel] ??= []).push(`${rel}:${i + 1}`);
      });
    }
    const unexpected = Object.entries(unsorted).filter(([rel, at]) => at.length !== (ALWAYS_ON[rel] ?? 0));
    expect(unexpected.map(([, at]) => at).flat(), "sort it into a topic, or add it to ALWAYS_ON with the reason").toEqual([]);
    // And the list above is not stale.
    for (const [rel, n] of Object.entries(ALWAYS_ON)) {
      if (rel === "src/lib/notify.ts") continue;
      expect((unsorted[rel] ?? []).length, rel).toBe(n);
    }
  });

  it("only topics that exist are used", () => {
    const used = new Set<string>();
    for (const file of files) {
      for (const m of readFileSync(file, "utf8").matchAll(/\btopic: "([a-z_]+)"/g)) used.add(m[1]);
    }
    expect([...used].filter((t) => !isOfficeTopic(t))).toEqual([]);
    // Each topic on the page is one something is actually sent under.
    expect(OFFICE_TOPICS.map((t) => t.key).filter((k) => !used.has(k))).toEqual([]);
  });
});
