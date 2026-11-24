/**
 * What a company pastes into its own website to send visitors to its
 * booking page (roadmap phase 6, "a button and an embeddable version").
 *
 *   - The button: a plain link styled as a button. Works on every website
 *     builder, because it is only a link.
 *   - The embed: one script tag that puts the whole booking page on their
 *     page, sized to fit (public/embed/book.js).
 *
 * Plain functions so the exact text can be tested.
 */

const escapeAttr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function bookingPageUrl(site: string, slug: string): string {
  return `${site.replace(/\/$/, "")}/book/${encodeURIComponent(slug)}`;
}

/** A link that looks like a button, in the company's own colours. */
export function bookingButtonHtml(
  site: string,
  slug: string,
  colors: { backgroundColor: string; color: string },
  label = "Book a clean",
): string {
  const style = [
    "display:inline-block",
    "padding:14px 28px",
    "border-radius:12px",
    `background:${colors.backgroundColor}`,
    `color:${colors.color}`,
    "font:600 18px/1.2 system-ui,-apple-system,'Segoe UI',sans-serif",
    "text-decoration:none",
  ].join(";");
  return `<a href="${escapeAttr(bookingPageUrl(site, slug))}" style="${escapeAttr(style)}">${escapeAttr(label)}</a>`;
}

/** One script tag: the booking page itself, on their page, sized to fit. */
export function bookingEmbedHtml(site: string, slug: string): string {
  return `<script src="${escapeAttr(`${site.replace(/\/$/, "")}/embed/book.js`)}" data-company="${escapeAttr(slug)}"></script>`;
}
