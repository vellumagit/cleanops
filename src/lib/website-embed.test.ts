import { describe, expect, it } from "vitest";
import { bookingButtonHtml, bookingEmbedHtml, bookingPageUrl } from "./website-embed";

describe("what a company pastes into its website", () => {
  it("the button is a link to the page, in the company's colours", () => {
    expect(bookingButtonHtml("https://sollos3.com", "svit", { backgroundColor: "#0f766e", color: "#ffffff" })).toBe(
      `<a href="https://sollos3.com/book/svit" style="display:inline-block;padding:14px 28px;border-radius:12px;background:#0f766e;color:#ffffff;font:600 18px/1.2 system-ui,-apple-system,'Segoe UI',sans-serif;text-decoration:none">Book a clean</a>`,
    );
  });

  it("the embed is one script tag naming the company", () => {
    expect(bookingEmbedHtml("https://sollos3.com/", "svit")).toBe(
      `<script src="https://sollos3.com/embed/book.js" data-company="svit"></script>`,
    );
  });

  it("nothing in a name or colour can break out of the attribute", () => {
    const html = bookingButtonHtml("https://sollos3.com", 'a"b', { backgroundColor: '"><script>', color: "#fff" }, "<b>");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
    expect(bookingEmbedHtml("https://sollos3.com", 'x" onload="y')).toContain('data-company="x&quot; onload=&quot;y"');
    expect(bookingPageUrl("https://sollos3.com", "a b")).toBe("https://sollos3.com/book/a%20b");
  });
});
