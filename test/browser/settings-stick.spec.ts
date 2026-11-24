/**
 * Settings checkboxes keep what you saved, on screen, without a reload.
 *
 * React 19 resets a `<form action>` after a successful save, and a browser
 * reset puts each checkbox back to the value the page was first drawn with.
 * React does not redraw a controlled box whose state hasn't changed, so the
 * screen went stale: "What alerts you" saved every box ticked and then
 * showed every box unticked, toast and all (Brian, 2026-11-24). It had been
 * "cured" once already (864065ee, Aug 28) in a way that never reached the
 * screen. src/lib/keep-form-on-save.ts is the fix; this is what holds it.
 */
import type { Page } from "puppeteer-core";
import { beforeAll, describe, expect, it } from "vitest";
import { click, expectNoCrash, getStack, openAs, visit, type Stack } from "./stack";
import { company, one } from "./world";

let stack: Stack;
beforeAll(async () => {
  stack = await getStack();
});

/** Each matching checkbox, as 1 (ticked) or 0, in page order. */
const ticks = (page: Page, selector: string): Promise<string> =>
  page.$$eval(selector, (els) => els.map((e) => ((e as HTMLInputElement).checked ? "1" : "0")).join(""));

/** Click the boxes at these positions, so React sees real changes. */
async function toggle(page: Page, selector: string, positions: number[]): Promise<void> {
  const boxes = await page.$$(selector);
  for (const i of positions) await boxes[i].click();
}

/** Save, and wait until the save has come back and the button is ready again. */
async function save(page: Page, label: RegExp, saved: () => Promise<unknown>, expected: unknown): Promise<void> {
  await click(page, label);
  await expect.poll(saved, { timeout: 20_000 }).toEqual(expected);
  await page.waitForFunction(
    (source: string) =>
      [...document.querySelectorAll("button[type=submit]")].some(
        (b) => new RegExp(source, "i").test(b.textContent ?? "") && !(b as HTMLButtonElement).disabled,
      ),
    { timeout: 20_000 },
    label.source,
  );
  // Past the moment React resets the form after the action.
  await new Promise((r) => setTimeout(r, 1_000));
}

describe("settings checkboxes stick after Save", () => {
  it("What alerts you: ticked and unticked boxes stay as saved, then a reload agrees", async () => {
    const c = await company(stack, "Alerts");
    const owner = await openAs(stack, c.owner);
    const box = 'input[name="alert"]';
    const muted = () =>
      one<string>(
        stack,
        "select coalesce(jsonb_array_length(notification_prefs->'muted_topics'), 0)::text from public.memberships where id = $1",
        [c.owner.membershipId],
      );
    try {
      await visit(stack, owner.page, "/app/notifications/choices");
      const all = (await ticks(owner.page, box)).length;
      expect(all).toBeGreaterThan(2);
      expect(await ticks(owner.page, box)).toBe("1".repeat(all));

      // Untick everything: the case Brian hit, in reverse.
      await toggle(owner.page, box, [...Array(all).keys()]);
      await save(owner.page, /^Save$/, muted, String(all));
      expect(await ticks(owner.page, box)).toBe("0".repeat(all));

      // Tick everything back on. Before the fix the screen showed all
      // unticked here, the values the page was drawn with.
      await toggle(owner.page, box, [...Array(all).keys()]);
      await save(owner.page, /^Save$/, muted, "0");
      expect(await ticks(owner.page, box)).toBe("1".repeat(all));

      // A mix.
      await toggle(owner.page, box, [0, 2]);
      await save(owner.page, /^Save$/, muted, "2");
      const mixed = await ticks(owner.page, box);
      expect(mixed).toBe("0" + "1" + "0" + "1".repeat(all - 3));

      await visit(stack, owner.page, "/app/notifications/choices");
      expect(await ticks(owner.page, box)).toBe(mixed);
      await expectNoCrash(owner);
    } finally {
      await owner.close();
    }
  });

  it("Bonus rules: a switched-on rule shows on after Save", async () => {
    const c = await company(stack, "Bonus");
    const owner = await openAs(stack, c.owner);
    const box = 'input[name="enabled"], input[name="efficiency_enabled"]';
    const saved = () =>
      one<string>(
        stack,
        `select coalesce((select (enabled::int)::text || (efficiency_enabled::int)::text
                            from public.bonus_rules where organization_id = $1), 'none')`,
        [c.org],
      );
    try {
      await visit(stack, owner.page, "/app/settings/bonus-rules");
      const start = await ticks(owner.page, box);
      const flipped = [...start].map((t) => (t === "1" ? "0" : "1")).join("");
      await toggle(owner.page, box, [0, 1]);
      await save(owner.page, /Save rules/i, saved, flipped);
      expect(await ticks(owner.page, box)).toBe(flipped);
      await expectNoCrash(owner);
    } finally {
      await owner.close();
    }
  });
});
