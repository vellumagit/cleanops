/**
 * Server-side PDF rendering for estimates — pdf-lib, no browser.
 *
 * Replaces the headless-Chromium renderer, which could not launch on the
 * Vercel runtime (libnss3.so missing — the browser process died before the
 * first byte). The invoice PDF hit the identical wall and was migrated to
 * pdf-lib already; estimates kept the broken path until Brian clicked
 * "PDF" on a fresh website lead and got the 500 to prove it.
 *
 * Keeps the old signature — renderEstimatePdf({ publicToken }) — so both
 * callers (the /api/e/[token]/pdf route and sendEstimateToClient's email
 * attachment) stay untouched: this module fetches its own data by token.
 */

import "server-only";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type RGB,
} from "pdf-lib";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatCurrencyCents, type CurrencyCode } from "@/lib/format";
import { getOrgCurrency } from "@/lib/org-currency";

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
    .replace(/[—–]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[-]/g, "")
    .replace(/[^ -ÿ]/g, "");
}

export async function renderEstimatePdf(opts: {
  publicToken: string;
  /** Kept for signature compatibility with the Chromium era; unused. */
  siteUrl?: string;
}): Promise<Buffer> {
  const admin = createSupabaseAdminClient();
  const { data: est } = (await admin
    .from("estimates")
    .select(
      "id, organization_id, status, total_cents, service_description, notes, created_at, expires_at, client:clients ( name, email )",
    )
    .eq("public_token" as never, opts.publicToken as never)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      organization_id: string;
      status: string;
      total_cents: number;
      service_description: string | null;
      notes: string | null;
      created_at: string;
      expires_at: string | null;
      client: { name: string | null; email: string | null } | null;
    } | null;
  };
  if (!est) throw new Error(`estimate not found for token`);

  const [{ data: org }, currency] = await Promise.all([
    admin
      .from("organizations")
      .select("name, brand_color")
      .eq("id", est.organization_id)
      .maybeSingle() as unknown as Promise<{
      data: { name: string | null; brand_color: string | null } | null;
    }>,
    getOrgCurrency(est.organization_id) as Promise<CurrencyCode>,
  ]);

  const orgName = org?.name ?? "Estimate";
  const brand = hexToRgb(org?.brand_color);

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const ink = rgb(0.1, 0.1, 0.12);
  const muted = rgb(0.45, 0.45, 0.5);
  const ruleColor = rgb(0.85, 0.85, 0.88);

  const PW = 612;
  const PH = 792;
  const M = 50;
  const RIGHT = PW - M;
  const BODY_MAX = RIGHT - M;

  let page = doc.addPage([PW, PH]);
  let y = PH - M;

  function text(
    s: string,
    x: number,
    size = 10,
    f: PDFFont = font,
    color: RGB = ink,
  ) {
    page.drawText(clean(s), { x, y, size, font: f, color });
  }
  function textR(
    s: string,
    xRight: number,
    size = 10,
    f: PDFFont = font,
    color: RGB = ink,
  ) {
    const c = clean(s);
    const w = f.widthOfTextAtSize(c, size);
    page.drawText(c, { x: xRight - w, y, size, font: f, color });
  }
  function hline(thickness = 0.5, color: RGB = ruleColor) {
    page.drawLine({
      start: { x: M, y },
      end: { x: RIGHT, y },
      thickness,
      color,
    });
  }
  /** Word-wrap into lines that fit; newlines in the source are respected —
   *  the intake endpoints write multi-line detail blocks and every line of
   *  the lead's story belongs on the quote. */
  function wrap(s: string, size: number, maxWidth: number): string[] {
    const out: string[] = [];
    for (const rawLine of clean(s).split("\n")) {
      const words = rawLine.split(/\s+/).filter(Boolean);
      if (words.length === 0) {
        out.push("");
        continue;
      }
      let cur = "";
      for (const w of words) {
        const probe = cur ? `${cur} ${w}` : w;
        if (font.widthOfTextAtSize(probe, size) <= maxWidth) {
          cur = probe;
        } else {
          if (cur) out.push(cur);
          cur = w;
        }
      }
      if (cur) out.push(cur);
    }
    return out;
  }
  function ensureRoom(needed: number) {
    if (y < needed) {
      page = doc.addPage([PW, PH]);
      y = PH - M;
    }
  }

  const dateFmt = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : null;

  // ── Header ───────────────────────────────────────────────────────────────
  text(orgName, M, 18, bold, brand);
  textR("ESTIMATE", RIGHT, 18, bold, ink);
  y -= 16;
  textR(dateFmt(est.created_at) ?? "", RIGHT, 11, font, muted);
  y -= 34;

  // ── Prepared for ─────────────────────────────────────────────────────────
  text("PREPARED FOR", M, 8, bold, muted);
  if (est.expires_at) textR("VALID UNTIL", RIGHT, 8, bold, muted);
  y -= 15;
  text(est.client?.name ?? "-", M, 11, bold, ink);
  if (est.expires_at) textR(dateFmt(est.expires_at) ?? "-", RIGHT, 11, bold, ink);
  y -= 13;
  if (est.client?.email) {
    text(est.client.email, M, 9, font, muted);
    y -= 12;
  }
  y -= 18;

  // ── Service ──────────────────────────────────────────────────────────────
  hline(1, brand);
  y -= 16;
  text("SERVICE", M, 8, bold, muted);
  y -= 14;
  for (const line of wrap(est.service_description || "Cleaning service", 11, BODY_MAX)) {
    ensureRoom(110);
    text(line, M, 11, font, ink);
    y -= 15;
  }
  y -= 6;

  // ── Details (the lead's story — property, add-ons, schedule) ─────────────
  if (est.notes) {
    ensureRoom(140);
    text("DETAILS", M, 8, bold, muted);
    y -= 14;
    for (const line of wrap(est.notes, 9, BODY_MAX)) {
      ensureRoom(110);
      text(line, M, 9, font, muted);
      y -= 13;
    }
    y -= 6;
  }

  // ── Total ────────────────────────────────────────────────────────────────
  ensureRoom(130);
  y -= 4;
  page.drawLine({
    start: { x: 400, y: y + 5 },
    end: { x: RIGHT, y: y + 5 },
    thickness: 0.5,
    color: ruleColor,
  });
  y -= 8;
  text("Estimated total", 400, 11, bold, ink);
  textR(formatCurrencyCents(est.total_cents, currency), RIGHT, 13, bold, brand);
  y -= 24;
  text(
    "This is an estimate, not an invoice — the final price is confirmed before any work begins.",
    M,
    8,
    font,
    muted,
  );

  // ── Footer ───────────────────────────────────────────────────────────────
  page.drawText(clean(`${orgName} - Estimate`), {
    x: M,
    y: 38,
    size: 8,
    font,
    color: muted,
  });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
