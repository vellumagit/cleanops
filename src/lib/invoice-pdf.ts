/**
 * Server-side PDF rendering for invoices.
 *
 * Mirror of lib/estimate-pdf.ts: headless Chromium (puppeteer-core +
 * @sparticuz/chromium) renders the existing public invoice page
 * (/i/[token]) and captures it as a PDF — same HTML, same brand styling,
 * no parallel layout to maintain.
 *
 * Callers:
 *   1. deliverInvoiceEmail (app/invoices/actions) — attaches the PDF to the
 *      outbound email so the client has a permanent copy that doesn't depend
 *      on the public token staying valid.
 *   2. /api/i/[token]/pdf — HTTP endpoint to download/view it.
 *
 * Cold-start cost: ~2–5s the first render per serverless instance, ~0.5–1s
 * warm — same as estimates.
 */

import "server-only";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

// Load the COMPLETE Chromium pack (binary + shared libs) from the matching
// @sparticuz release at runtime. Vercel's file tracer drops the .so libs from
// the bundle, so the locally-bundled binary fails with
// "libnss3.so: cannot open shared object file". The remote pack ships every
// dependency and is cached in /tmp after the first cold start. Must match the
// installed @sparticuz/chromium version (131.0.1).
const CHROMIUM_PACK =
  "https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar";

/**
 * Render the public invoice page to a PDF buffer. The public token in the
 * URL is the capability — the caller is responsible for resolving it.
 */
export async function renderInvoicePdf(opts: {
  publicToken: string;
  /** Override the base URL — production defaults to NEXT_PUBLIC_SITE_URL. */
  siteUrl?: string;
}): Promise<Buffer> {
  const siteUrl =
    opts.siteUrl ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    "https://sollos3.com";

  // ?pdf=1 lets the page drop interactive payment buttons in print output
  // (the page ignores it if unhandled — harmless either way).
  const url = `${siteUrl}/i/${opts.publicToken}?pdf=1`;

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(CHROMIUM_PACK),
    headless: true,
  });

  try {
    const page = await browser.newPage();

    // Wait for the `load` event (logo + CSS fetched) rather than full network
    // idle. The invoice page can hold a connection open (payment SDK /
    // realtime) that never lets networkidle0 settle, which timed out the
    // render and dropped the email attachment. `load` fires regardless of
    // those long-lived connections but still waits for the images/styles, and
    // we don't hard-fail if it's slow — we capture what's painted.
    try {
      await page.goto(url, { waitUntil: "load", timeout: 30_000 });
    } catch {
      // Slow/hanging resource — proceed and capture the current frame.
    }

    // Let fonts / the logo image finish painting before capture.
    await new Promise((resolve) => setTimeout(resolve, 700));

    const pdf = await page.pdf({
      format: "letter",
      printBackground: true, // brand color band depends on this
      margin: { top: "0.5in", bottom: "0.5in", left: "0.5in", right: "0.5in" },
      displayHeaderFooter: false,
    });

    return Buffer.from(pdf);
  } finally {
    // Always close — leaked Chromium processes exhaust function memory fast.
    await browser.close();
  }
}
