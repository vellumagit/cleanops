/**
 * Colours for a button filled with a company's brand colour.
 *
 * Public pages put white text on the brand colour. A company whose brand
 * colour is white, cream or pale yellow got a white button with white text:
 * a blank rectangle where "Approve estimate" should be (hand test,
 * 2026-11-19). The text is now dark on a light colour, the border is always
 * visible, and a value that isn't a colour falls back to the default.
 */
const FALLBACK = "#4f46e5";

function parseHex(input: string | null | undefined): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((input ?? "").trim());
  if (!m) return null;
  const hex = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** Relative luminance, 0 (black) to 1 (white), per WCAG. */
function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function brandButtonColors(brand: string | null | undefined): {
  backgroundColor: string;
  color: string;
  borderColor: string;
} {
  const rgb = parseHex(brand);
  if (!rgb) return { backgroundColor: FALLBACK, color: "#ffffff", borderColor: FALLBACK };
  const background = `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  const lum = luminance(rgb);
  // Above this, dark text has the better contrast.
  const light = lum > 0.45;
  return {
    backgroundColor: background,
    color: light ? "#111827" : "#ffffff",
    // A near-white button needs an edge to be seen against a white page.
    borderColor: lum > 0.8 ? "#9ca3af" : background,
  };
}
