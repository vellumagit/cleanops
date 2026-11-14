import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { blogSlug, plainText, sanitizeArticleHtml } from "./blog";
import { verifyHoloRequest } from "./holo-webhook";

describe("sanitizeArticleHtml: what an article may contain", () => {
  it("removes anything that could run code", () => {
    const dirty = [
      `<p onclick="steal()">Hello</p>`,
      `<script>alert(1)</script>`,
      `<style>body{display:none}</style>`,
      `<iframe src="https://evil.example"></iframe>`,
      `<a href="javascript:alert(1)">click</a>`,
      `<img src="x" onerror="alert(1)">`,
      `<form action="https://evil.example"><input name="pw"></form>`,
      `<a href="data:text/html;base64,PHNjcmlwdD4=">data</a>`,
    ].join("");
    const clean = sanitizeArticleHtml(dirty);
    expect(clean).not.toMatch(/script|onclick|onerror|iframe|javascript:|<style|<form|<input|data:/i);
    expect(clean).toContain("<p>Hello</p>");
  });

  it("keeps the article itself", () => {
    const html = `<h2>Why</h2><p>Text with <strong>bold</strong> and <a href="/pricing">a link</a>.</p><ul><li>One</li></ul><table><tr><td>1</td></tr></table><blockquote>Quote</blockquote>`;
    const clean = sanitizeArticleHtml(html);
    for (const part of ["<h2>Why</h2>", "<strong>bold</strong>", `<a href="/pricing">a link</a>`, "<li>One</li>", "<td>1</td>", "<blockquote>Quote</blockquote>"]) {
      expect(clean).toContain(part);
    }
  });

  it("turns an h1 into an h2 (the page's title is the h1)", () => {
    expect(sanitizeArticleHtml("<h1>Big</h1>")).toBe("<h2>Big</h2>");
  });

  it("opens outside links in a new tab without handing over the page", () => {
    expect(sanitizeArticleHtml(`<a href="https://example.com/x">x</a>`)).toBe(
      `<a href="https://example.com/x" rel="noopener noreferrer" target="_blank">x</a>`,
    );
    expect(sanitizeArticleHtml(`<a href="https://sollos3.com/pricing">p</a>`)).toBe(`<a href="https://sollos3.com/pricing">p</a>`);
  });

  it("allows only https images", () => {
    expect(sanitizeArticleHtml(`<img src="https://cdn.example/a.png" alt="A">`)).toBe(
      `<img src="https://cdn.example/a.png" alt="A" loading="lazy" />`,
    );
    expect(sanitizeArticleHtml(`<img src="http://cdn.example/a.png">`)).not.toContain("http://");
  });
});

describe("blogSlug and plainText", () => {
  it("makes an address from a title", () => {
    expect(blogSlug("Best Cleaning Checklist (2026)!")).toBe("best-cleaning-checklist-2026");
    expect(blogSlug("Café façade cleaning")).toBe("cafe-facade-cleaning");
    expect(blogSlug("   ")).toBeNull();
    expect(blogSlug("!!!")).toBeNull();
  });

  it("strips tags from titles and descriptions", () => {
    expect(plainText(`<b>Clean</b> &amp; tidy`)).toBe("Clean & tidy");
    expect(plainText("x".repeat(20), 10)).toBe(`${"x".repeat(9)}…`);
  });
});

describe("verifyHoloRequest", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ event: "article.published" });
  const sig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

  it("accepts Holo's HMAC signature or its bearer secret", () => {
    expect(verifyHoloRequest({ rawBody: body, signatureHeader: sig, authorizationHeader: null, secret })).toBe(true);
    expect(verifyHoloRequest({ rawBody: body, signatureHeader: null, authorizationHeader: `Bearer ${secret}`, secret })).toBe(true);
  });

  it("refuses a wrong signature, a changed body, a wrong token, or nothing", () => {
    expect(verifyHoloRequest({ rawBody: body + " ", signatureHeader: sig, authorizationHeader: null, secret })).toBe(false);
    expect(verifyHoloRequest({ rawBody: body, signatureHeader: "sha256=00", authorizationHeader: null, secret })).toBe(false);
    expect(verifyHoloRequest({ rawBody: body, signatureHeader: null, authorizationHeader: "Bearer nope", secret })).toBe(false);
    expect(verifyHoloRequest({ rawBody: body, signatureHeader: null, authorizationHeader: null, secret })).toBe(false);
    expect(verifyHoloRequest({ rawBody: body, signatureHeader: sig, authorizationHeader: null, secret: "" })).toBe(false);
  });
});
