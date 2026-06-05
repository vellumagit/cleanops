/**
 * Server-side PDF rendering for estimates.
 *
 * Headless Chromium via puppeteer-core + @sparticuz/chromium (the
 * Lambda-optimized Chromium build). We render the existing public
 * estimate page (/e/[token]) and capture as PDF — same HTML, same
 * brand styling, no parallel layout to maintain.
 *
 * Two callers:
 *   1. /api/e/[token]/pdf — HTTP endpoint, streams the PDF inline so
 *      the browser opens it in a new tab and the user can download
 *      via the browser's built-in PDF UI.
 *   2. sendEstimateToClient (lib/automations) — attaches the PDF
 *      buffer to the outbound email so the customer has a permanent
 *      copy that doesn't depend on the public token still being valid.
 *
 * Cold-start cost: ~2–5s on Vercel the first time per instance/region
 * (Chromium has to spin up). Subsequent renders on a warm instance
 * are ~500ms–1s. Worth the cost vs maintaining a parallel React-PDF
 * layout that would drift from the web design.
 */

import "server-only";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

/**
 * Render the public estimate page to a PDF buffer.
 *
 * The caller is responsible for verifying that the requestor is
 * allowed to see this estimate — the public token in the URL is the
 * capability, just like the /e/[token] HTML page itself. Rate
 * limiting also lives at the route handler.
 */
export async function renderEstimatePdf(opts: {
  publicToken: string;
  /** Override the base URL — production defaults to NEXT_PUBLIC_SITE_URL. */
  siteUrl?: string;
}): Promise<Buffer> {
  const siteUrl =
    opts.siteUrl ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    "https://sollos3.com";

  const url = `${siteUrl}/e/${opts.publicToken}`;

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: true,
  });

  try {
    const page = await browser.newPage();

    // networkidle0 waits for ALL network activity to settle — important
    // because the estimate page loads the org logo from an external URL
    // (Supabase storage) and we want it on the PDF. Timeout generously
    // so a slow logo CDN doesn't kill the render.
    await page.goto(url, { waitUntil: "networkidle0", timeout: 30_000 });

    // Tiny delay so any CSS animations / font-loading finish painting
    // before we capture. 200ms is well below the perceived wait threshold
    // and far cheaper than waiting on font-loading events explicitly.
    await new Promise((resolve) => setTimeout(resolve, 200));

    const pdf = await page.pdf({
      format: "letter",
      printBackground: true, // brand color band depends on this
      margin: {
        top: "0.5in",
        bottom: "0.5in",
        left: "0.5in",
        right: "0.5in",
      },
      // No browser-default header/footer (page numbers, URL) — the
      // estimate is a single-page document with its own footer.
      displayHeaderFooter: false,
    });

    // puppeteer types return Uint8Array on some versions; force to Buffer
    // so callers (Resend attachment, NextResponse) get a consistent shape.
    return Buffer.from(pdf);
  } finally {
    // Always close the browser even if rendering throws — leaked
    // Chromium processes hold ~150MB each and exhaust function memory
    // within a handful of cold starts.
    await browser.close();
  }
}
