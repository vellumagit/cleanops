/**
 * Server-side invoice PDF rendering — pure JavaScript (pdf-lib).
 *
 * Replaces the previous headless-Chromium renderer, which couldn't launch on
 * the Vercel runtime (libnss3.so missing). pdf-lib has no native dependencies
 * and no browser, so it runs in a normal serverless function in milliseconds —
 * reliable forever, no extra memory/time config, no external service.
 *
 * The caller (the /api/i/[token]/pdf route) resolves the invoice by token and
 * passes the data in.
 */

import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type RGB } from "pdf-lib";
import { formatCurrencyCents, type CurrencyCode } from "@/lib/format";

export type InvoicePdfLine = {
  label: string;
  quantity: number;
  unitPriceCents: number;
};

export type InvoicePdfData = {
  invoiceNumber: string;
  dueDate: string | null;
  orgName: string;
  brandColorHex?: string | null;
  clientName: string;
  clientEmail?: string | null;
  currency: CurrencyCode;
  lineItems: InvoicePdfLine[];
  subtotalCents: number;
  /** e.g. "HST (13%)". Omit (with taxAmountCents null) when there's no tax. */
  taxLabel?: string | null;
  taxAmountCents?: number | null;
  totalCents: number;
};

function hexToRgb(hex?: string | null): RGB {
  const h = (hex ?? "").replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return rgb(0.1, 0.1, 0.12);
  return rgb(
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  );
}

/** Map/strip characters the WinAnsi standard fonts can't encode, so a stray
 *  unicode glyph (emoji, smart quote, CJK) never throws mid-render. */
function clean(s: string): string {
  return (s ?? "")
    .replace(/[—–]/g, "-") // em / en dash -> hyphen
    .replace(/[‘’]/g, "'") // curly single quotes
    .replace(/[“”]/g, '"') // curly double quotes
    .replace(/[-]/g, "") // CP1252 control band (undefined glyphs)
    .replace(/[^ -ÿ]/g, ""); // keep printable ASCII + Latin-1
}

export async function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const brand = hexToRgb(data.brandColorHex);
  const ink = rgb(0.1, 0.1, 0.12);
  const muted = rgb(0.45, 0.45, 0.5);
  const ruleColor = rgb(0.85, 0.85, 0.88);

  const PW = 612;
  const PH = 792;
  const M = 50;
  const RIGHT = PW - M;
  const QTY_R = 410;
  const UNIT_R = 492;
  const AMT_R = RIGHT;
  const DESC_MAX = 300;
  const LABEL_X = 400;

  let page = doc.addPage([PW, PH]);
  let y = PH - M;

  function text(s: string, x: number, size = 10, f: PDFFont = font, color: RGB = ink) {
    page.drawText(clean(s), { x, y, size, font: f, color });
  }
  function textR(s: string, xRight: number, size = 10, f: PDFFont = font, color: RGB = ink) {
    const c = clean(s);
    const w = f.widthOfTextAtSize(c, size);
    page.drawText(c, { x: xRight - w, y, size, font: f, color });
  }
  function hline(thickness = 0.5, color: RGB = ruleColor) {
    page.drawLine({ start: { x: M, y }, end: { x: RIGHT, y }, thickness, color });
  }
  function fit(s: string, size: number, maxWidth: number): string {
    let c = clean(s);
    if (font.widthOfTextAtSize(c, size) <= maxWidth) return c;
    while (c.length > 1 && font.widthOfTextAtSize(c + "...", size) > maxWidth) {
      c = c.slice(0, -1);
    }
    return c + "...";
  }
  function drawTableHeader() {
    hline(1, brand);
    y -= 14;
    text("DESCRIPTION", M, 8, bold, muted);
    textR("QTY", QTY_R, 8, bold, muted);
    textR("UNIT", UNIT_R, 8, bold, muted);
    textR("AMOUNT", AMT_R, 8, bold, muted);
    y -= 8;
    hline(0.5, ruleColor);
    y -= 16;
  }

  // ── Header ───────────────────────────────────────────────────────────────
  text(data.orgName, M, 18, bold, brand);
  textR("INVOICE", RIGHT, 18, bold, ink);
  y -= 16;
  textR(`#${data.invoiceNumber}`, RIGHT, 11, font, muted);
  y -= 34;

  // ── Bill to + due ─────────────────────────────────────────────────────────
  text("BILL TO", M, 8, bold, muted);
  textR("DUE", RIGHT, 8, bold, muted);
  y -= 15;
  text(data.clientName, M, 11, bold, ink);
  textR(data.dueDate ?? "-", RIGHT, 11, bold, ink);
  y -= 13;
  if (data.clientEmail) text(data.clientEmail, M, 9, font, muted);
  y -= 30;

  // ── Line items (paginated) ────────────────────────────────────────────────
  drawTableHeader();
  for (const li of data.lineItems) {
    if (y < 110) {
      page = doc.addPage([PW, PH]);
      y = PH - M;
      drawTableHeader();
    }
    const amt = Math.round(li.quantity * li.unitPriceCents);
    text(fit(li.label, 9, DESC_MAX), M, 9, font, ink);
    textR(String(li.quantity), QTY_R, 9, font, muted);
    textR(formatCurrencyCents(li.unitPriceCents, data.currency), UNIT_R, 9, font, muted);
    textR(formatCurrencyCents(amt, data.currency), AMT_R, 9, font, ink);
    y -= 9;
    hline(0.5, ruleColor);
    y -= 16;
  }

  // ── Totals ────────────────────────────────────────────────────────────────
  if (y < 130) {
    page = doc.addPage([PW, PH]);
    y = PH - M;
  }
  y -= 6;
  text("Subtotal", LABEL_X, 9, font, muted);
  textR(formatCurrencyCents(data.subtotalCents, data.currency), AMT_R, 9, font, ink);
  y -= 16;
  if (data.taxAmountCents != null && data.taxLabel) {
    text(data.taxLabel, LABEL_X, 9, font, muted);
    textR(formatCurrencyCents(data.taxAmountCents, data.currency), AMT_R, 9, font, ink);
    y -= 16;
  }
  page.drawLine({
    start: { x: LABEL_X, y: y + 5 },
    end: { x: AMT_R, y: y + 5 },
    thickness: 0.5,
    color: ruleColor,
  });
  y -= 6;
  text("Total", LABEL_X, 13, bold, ink);
  textR(formatCurrencyCents(data.totalCents, data.currency), AMT_R, 13, bold, brand);

  // ── Footer ────────────────────────────────────────────────────────────────
  page.drawText(clean(`${data.orgName} - Invoice #${data.invoiceNumber}`), {
    x: M,
    y: 38,
    size: 8,
    font,
    color: muted,
  });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
