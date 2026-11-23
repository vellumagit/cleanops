/**
 * The pages a client sees before they are in (2026-11-22): type an email,
 * get told to check it; the emailed link's landing with its one button; and
 * the door on the marketing site.
 *
 * The test stack has no auth server, so the email with the button is never
 * really sent here and a real token can't be spent. Those rules are tested
 * in test/db/client-sign-in.api.test.ts. This is the screens: that they
 * render, say the right thing, fit a phone, and fail in words.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { click, expectNoCrash, fill, getStack, says, visit, type Stack } from "./stack";

let stack: Stack;
beforeAll(async () => {
  stack = await getStack();
});

async function signedOut() {
  const context = await stack.browser.createBrowserContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return { page, errors, close: () => context.close() };
}
const overflow = (page: Awaited<ReturnType<typeof signedOut>>["page"]) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

describe("the client's way in", () => {
  it("the sign-in page asks for an email and nothing else, and answers the same for any address", async () => {
    const s = await signedOut();
    try {
      await s.page.setViewport({ width: 390, height: 844 });
      await visit(stack, s.page, "/client/login");
      const text = await says(s.page, "See your cleans");
      expect(text).toContain("There is no password to remember.");
      // One field, one main button; no password box until it is asked for.
      expect(await s.page.$("input[type='password']")).toBeNull();
      expect(await overflow(s.page), "no sideways scroll on a phone").toBeLessThanOrEqual(1);

      await fill(s.page, "#email", "nobody-we-know@example.test");
      await click(s.page, "Email me a link");
      const sent = await says(s.page, "Check your email.");
      expect(sent).toContain("nobody-we-know@example.test");
      expect(sent).toMatch(/Open my cleans/);
      expect(await overflow(s.page)).toBeLessThanOrEqual(1);

      // Back to the form, and the password route is there for those who have one.
      await click(s.page, "Use a different email");
      await click(s.page, "I have a password");
      await s.page.waitForSelector("input[type='password']", { visible: true });
      await click(s.page, "Email me a link instead");
      expect(await s.page.$("input[type='password']")).toBeNull();
      expect(s.errors).toEqual([]);
    } finally {
      await s.close();
    }
  });

  it("the emailed link lands on one button; a link that no longer works says so and offers a new one", async () => {
    const s = await signedOut();
    try {
      await s.page.setViewport({ width: 390, height: 844 });
      await visit(stack, s.page, "/client/enter?t=not-a-real-token-0123456789");
      await says(s.page, "You're almost in");
      expect(await overflow(s.page)).toBeLessThanOrEqual(1);
      await click(s.page, "Open my cleans");
      const text = await says(s.page, /already been used, or is more than an hour old/);
      expect(text).toContain("See your cleans");
      expect(new URL(s.page.url()).pathname).toBe("/client/login");
      // No link at all goes straight to the sign-in page.
      await visit(stack, s.page, "/client/enter");
      await says(s.page, "See your cleans");
      expect(s.errors).toEqual([]);
    } finally {
      await s.close();
    }
  });

  it("the Sollos site points a client to it, from the footer and from the staff sign-in page", async () => {
    const s = await signedOut();
    try {
      await visit(stack, s.page, "/login");
      await says(s.page, "Here to see your cleaner?");
      await click(s.page, "See your cleans");
      await says(s.page, "Email me a link");
      expect(new URL(s.page.url()).pathname).toBe("/client/login");

      await visit(stack, s.page, "/pricing");
      const footer = await s.page.$eval("footer", (el) => (el as HTMLElement).innerText);
      expect(footer).toContain("Here to see your cleaner?");
      expect(s.errors).toEqual([]);
    } finally {
      await s.close();
    }
  });
});

describe("the invite page", () => {
  it("a made-up invite says so, with no password box anywhere", async () => {
    const s = await signedOut();
    try {
      await visit(stack, s.page, "/client/claim/not-a-real-invite-token-0000");
      await says(s.page, "Your cleaner invited you");
      expect(await s.page.$("input[type='password']")).toBeNull();
      await click(s.page, "Open my cleans");
      await says(s.page, "Invalid or expired link.");
      await expectNoCrash({ page: s.page, errors: s.errors, close: s.close } as never);
    } finally {
      await s.close();
    }
  });
});
