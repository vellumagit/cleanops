/**
 * The pay invoice as a PDF (pdf-lib, no browser), in the same hand as the
 * client invoice PDF (lib/invoice-pdf.ts): Letter page, the company's brand
 * colour on the rule and the total.
 *
 * It reads as an invoice FROM the worker TO the company, with one line per
 * shift, so each side has the same paper for its records.
 */

import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type RGB } from "pdf-lib";
import { formatCurrencyCents } from "@/lib/format";
import type { PayInvoice } from "@/lib/pay-invoice";

function hexToRgb(hex?: string | null): RGB {
  const h = (hex ?? "").replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return rgb(0.1, 0.1, 0.12);
  return rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255);
}

/** Map or drop what the standard fonts can't encode, so a stray emoji or
 *  smart quote in a client's name never throws mid-render. */
function clean(s: string): string {
  return (s ?? "")
    .replace(/[—–]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[\u0080-\u009F]/g, "")
    .replace(/[^ -ÿ]/g, "");
}

function shortDate(ymd: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(new Date(`${ymd}T00:00:00Z`));
}

function longDate(ymd: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" }).format(new Date(`${ymd}T00:00:00Z`));
}

export async function renderPayInvoicePdf(inv: PayInvoice): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${inv.number}`);
  doc.setAuthor(clean(inv.workerName));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const brand = hexToRgb(inv.brandColor);
  const ink = rgb(0.1, 0.1, 0.12);
  const muted = rgb(0.45, 0.45, 0.5);
  const rule = rgb(0.85, 0.85, 0.88);

  const PW = 612, PH = 792, M = 50, RIGHT = PW - M;
  const DATE_X = M, DESC_X = 128, HOURS_R = 410, RATE_R = 482, AMT_R = RIGHT;
  const DESC_MAX = HOURS_R - 40 - DESC_X;
  const LABEL_X = 380;

  let page = doc.addPage([PW, PH]);
  let y = PH - M;
  let pageNo = 1;

  const text = (s: string, x: number, size = 10, f: PDFFont = font, color: RGB = ink) =>
    page.drawText(clean(s), { x, y, size, font: f, color });
  const textR = (s: string, xRight: number, size = 10, f: PDFFont = font, color: RGB = ink) => {
    const c = clean(s);
    page.drawText(c, { x: xRight - f.widthOfTextAtSize(c, size), y, size, font: f, color });
  };
  const hline = (thickness = 0.5, color: RGB = rule) =>
    page.drawLine({ start: { x: M, y }, end: { x: RIGHT, y }, thickness, color });
  const fit = (s: string, size: number, maxWidth: number, f: PDFFont = font): string => {
    let c = clean(s);
    if (f.widthOfTextAtSize(c, size) <= maxWidth) return c;
    while (c.length > 1 && f.widthOfTextAtSize(`${c}...`, size) > maxWidth) c = c.slice(0, -1);
    return `${c}...`;
  };
  const footer = () => {
    page.drawText(clean(`${inv.workerName} - Invoice ${inv.number} - page ${pageNo}`), { x: M, y: 38, size: 8, font, color: muted });
  };
  const tableHeader = () => {
    hline(1, brand);
    y -= 14;
    text("DATE", DATE_X, 8, bold, muted);
    text("DESCRIPTION", DESC_X, 8, bold, muted);
    textR("HOURS", HOURS_R, 8, bold, muted);
    textR("RATE", RATE_R, 8, bold, muted);
    textR("AMOUNT", AMT_R, 8, bold, muted);
    y -= 8;
    hline();
    y -= 16;
  };
  const newPage = () => {
    footer();
    page = doc.addPage([PW, PH]);
    pageNo += 1;
    y = PH - M;
  };

  // ── Header: who it is from, and that it is an invoice ──
  text(fit(inv.workerName, 18, 330, bold), M, 18, bold, ink);
  textR("INVOICE", RIGHT, 18, bold, brand);
  y -= 16;
  if (inv.workerEmail) text(inv.workerEmail, M, 9, font, muted);
  textR(inv.number, RIGHT, 11, font, muted);
  y -= 34;

  // ── Bill to, and the dates ──
  text("BILL TO", M, 8, bold, muted);
  text("INVOICE DATE", 300, 8, bold, muted);
  textR("PERIOD", RIGHT, 8, bold, muted);
  y -= 15;
  text(fit(inv.companyName, 11, 230, bold), M, 11, bold, ink);
  // Short month names here: two long dates side by side ran into the
  // invoice date beside them.
  text(shortDate(inv.issuedOn), 300, 10, font, ink);
  textR(`${shortDate(inv.periodStart)} - ${shortDate(inv.periodEnd)}`, RIGHT, 10, font, ink);
  y -= 14;
  text(inv.kind === "contractor" ? "For contract services" : "For services as an employee", M, 9, font, muted);
  y -= 30;

  // ── Lines, one per shift ──
  tableHeader();
  for (const li of inv.lines) {
    const rowHeight = li.detail ? 36 : 25;
    if (y - rowHeight < 64) {
      newPage();
      tableHeader();
    }
    text(li.date, DATE_X, 9, font, muted);
    text(fit(li.description, 9, DESC_MAX), DESC_X, 9, font, ink);
    if (li.hours != null) textR(li.hours.toFixed(2), HOURS_R, 9, font, muted);
    if (li.rateCents != null) textR(formatCurrencyCents(li.rateCents, inv.currency), RATE_R, 9, font, muted);
    textR(formatCurrencyCents(li.amountCents, inv.currency), AMT_R, 9, font, ink);
    if (li.detail) {
      y -= 11;
      text(fit(li.detail, 8, DESC_MAX + 60), DESC_X, 8, font, muted);
    }
    y -= 9;
    hline();
    y -= 16;
  }
  if (inv.lines.length === 0) {
    text("No lines.", DESC_X, 9, font, muted);
    y -= 25;
  }

  // ── Totals ──
  if (y < 190) newPage();
  y -= 6;
  text("Total hours", LABEL_X, 9, font, muted);
  textR(inv.totalHours.toFixed(2), AMT_R, 9, font, ink);
  y -= 16;
  text("Tax", LABEL_X, 9, font, muted);
  textR("None charged", AMT_R, 9, font, ink);
  y -= 12;
  page.drawLine({ start: { x: LABEL_X, y: y + 5 }, end: { x: AMT_R, y: y + 5 }, thickness: 0.5, color: rule });
  y -= 10;
  text("Total", LABEL_X, 13, bold, ink);
  textR(formatCurrencyCents(inv.totalCents, inv.currency), AMT_R, 13, bold, brand);
  y -= 22;
  const status =
    inv.runStatus === "paid"
      ? `Paid${inv.paidOn ? ` ${longDate(inv.paidOn)}` : ""}`
      : inv.runStatus === "draft"
        ? "Draft: not final"
        : "Payable";
  textR(status, AMT_R, 10, bold, inv.runStatus === "paid" ? rgb(0.1, 0.5, 0.3) : ink);
  y -= 34;

  // ── What this paper is, in plain words ──
  const notes = [
    `Prepared from ${inv.companyName}'s time records in Sollos, for the records of both parties.`,
    "No sales tax is charged and no deductions are shown on this invoice.",
    "It is not a T4, a T4A or a statement of deductions.",
  ];
  for (const n of notes) {
    text(fit(n, 8, RIGHT - M), M, 8, font, muted);
    y -= 11;
  }

  footer();
  return Buffer.from(await doc.save());
}
