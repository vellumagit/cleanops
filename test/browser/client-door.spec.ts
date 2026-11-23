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
import { company, daysFromNow, job } from "./world";

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

/**
 * The button in a booking email: one visit, no sign-in. The client sees
 * when it is and who is coming, and can ask to move it or cancel it.
 */
describe("the private link to one visit", () => {
  it("shows the visit under the company's name, takes a request to move it, then cancels it", async () => {
    const c = await company(stack, "VisitLink");
    const when = new Date(daysFromNow(5));
    when.setUTCHours(16, 0, 0, 0); // 10:00 AM company time
    const id = await job(stack, c, { at: when.toISOString(), minutes: 120, crew: [c.anna] });
    const token = "visitlinktoken0123456789ab";
    await stack.api.sql("update public.bookings set manage_token = $2 where id = $1", [id, token]);
    const [{ name: companyName }] = await stack.api.sql<{ name: string }>("select name from public.organizations where id = $1", [c.org]);

    const s = await signedOut();
    try {
      await s.page.setViewport({ width: 390, height: 844 });
      await visit(stack, s.page, `/v/${token}`);
      const text = await says(s.page, "Your clean");
      expect(text).toContain(companyName);
      expect(text).toContain("10:00 AM");
      expect(text).toContain("12 Test Street");
      expect(text).toMatch(/Your cleaner\s+Anna/);
      expect(await overflow(s.page), "no sideways scroll on a phone").toBeLessThanOrEqual(1);

      // Ask to move it: a request, and the visit stays.
      await click(s.page, /^Ask to move this visit/);
      await fill(s.page, "#visit-move", "Any morning next week");
      await click(s.page, "Ask to move it");
      await says(s.page, /They.ll be in touch about a new time/);
      const asked = await stack.api.sql<{ body: string; status: string }>(
        "select body, status from public.client_job_requests where booking_id = $1",
        [id],
      );
      expect(asked).toHaveLength(1);
      expect(asked[0].status).toBe("open");
      expect(asked[0].body).toContain("Any morning next week");
      expect(await overflow(s.page)).toBeLessThanOrEqual(1);

      // Cancel it: five days out, so it happens at once.
      await click(s.page, /^Cancel this visit/);
      await says(s.page, "This cancels this one visit.");
      await click(s.page, "Yes, cancel this visit");
      // The page reloads into the cancelled visit, which is the confirmation.
      await says(s.page, /It will not go ahead, and .+ knows\./);
      const [{ status }] = await stack.api.sql<{ status: string }>("select status::text as status from public.bookings where id = $1", [id]);
      expect(status).toBe("cancelled");

      // Opened again, the page says so and offers nothing to press.
      await visit(stack, s.page, `/v/${token}`);
      await says(s.page, "This visit was cancelled");
      expect(await s.page.$("#visit-move")).toBeNull();
      expect(s.errors).toEqual([]);
    } finally {
      await s.close();
    }
  });

  it("a link that isn't one says so and points to the sign-in page", async () => {
    const s = await signedOut();
    try {
      await visit(stack, s.page, "/v/not-a-real-visit-link-0000");
      await says(s.page, "This link has stopped working");
      await click(s.page, "See my cleans");
      await says(s.page, "Email me a link");
      expect(s.errors).toEqual([]);
    } finally {
      await s.close();
    }
  });
});

/**
 * Inside, once signed in: the cleaner's name on top, a client's own words on
 * the tabs, and the same three things to do about a visit.
 */
describe("the client area, signed in", () => {
  it("reads in plain words at phone width, and a visit can be asked to move", async () => {
    const c = await company(stack, "Inside");
    await stack.api.sql("update public.organizations set contact_phone = '(780) 555-0199' where id = $1", [c.org]);
    const [{ name: companyName }] = await stack.api.sql<{ name: string }>("select name from public.organizations where id = $1", [c.org]);
    const [user] = await stack.api.sql<{ id: string }>(
      "insert into auth.users (email, raw_user_meta_data) values ($1, '{}'::jsonb) returning id",
      [`inside.${Date.now()}@example.test`],
    );
    await stack.api.sql("update public.clients set profile_id = $2 where id = $1", [c.client, user.id]);
    const when = new Date(daysFromNow(5));
    when.setUTCHours(16, 0, 0, 0);
    const id = await job(stack, c, { at: when.toISOString(), minutes: 120, crew: [c.anna] });

    const s = await signedOut();
    try {
      await s.page.setViewport({ width: 390, height: 844 });
      for (const cookie of stack.api.sessionCookies(user.id, "inside@example.test")) {
        await s.page.setCookie({ name: cookie.name, value: cookie.value, url: stack.base });
      }
      await visit(stack, s.page, "/client");
      const home = await says(s.page, "Your next cleans, and anything there is to pay.");
      expect(home).toContain(companyName);
      expect(home).not.toMatch(/client portal|dashboard|account/i);
      for (const tab of ["Home", "My cleans", "New clean", "Invoices"]) expect(home).toContain(tab);
      expect(home).toContain("(780) 555-0199");
      expect(await overflow(s.page), "no sideways scroll on a phone").toBeLessThanOrEqual(1);

      await visit(stack, s.page, `/client/jobs/${id}`);
      await click(s.page, "Ask to move this visit");
      await fill(s.page, "textarea[name='wish']", "Friday afternoon instead");
      await click(s.page, "Ask to move it");
      await says(s.page, /The office will be in touch about a new time/);
      const asked = await stack.api.sql<{ body: string; status: string }>(
        "select body, status from public.client_job_requests where booking_id = $1",
        [id],
      );
      expect(asked).toHaveLength(1);
      expect(asked[0]).toMatchObject({ status: "open" });
      expect(asked[0].body).toContain("Friday afternoon instead");
      expect(await overflow(s.page)).toBeLessThanOrEqual(1);

      for (const path of ["/client/jobs", "/client/request", "/client/invoices"]) {
        await visit(stack, s.page, path);
        expect(await overflow(s.page), path).toBeLessThanOrEqual(1);
      }
      expect(s.errors).toEqual([]);
    } finally {
      await s.close();
    }
  });
});
