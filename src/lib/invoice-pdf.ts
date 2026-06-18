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
    executablePath: await chromium.executablePath(),
    headless: true,
  });

  try {
    const page = await browser.newPage();

    // networkidle0 waits for all network activity (incl. the org logo from
    // Supabase storage) to settle so it lands on the PDF.
    await page.goto(url, { waitUntil: "networkidle0", timeout: 30_000 });

    // Let fonts / any CSS finish painting before capture.
    await new Promise((resolve) => setTimeout(resolve, 200));

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
