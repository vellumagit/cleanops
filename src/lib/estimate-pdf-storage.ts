import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Where an estimate's attached PDF lives, and how anyone gets to read it.
 *
 * Until 2026-11-11 the PDF went into the public `org-assets` bucket (the one
 * that serves logos) at `{org}/estimates/{estimate}.pdf`, and the public URL
 * was stored on the estimate. Anyone holding that URL could read a client's
 * quote, address and prices, forever, without signing in; the path is made of
 * two ids and never expires.
 *
 * Now the file goes to the private `estimate-pdfs` bucket
 * (20261111040000) and `estimates.pdf_url` stores a reference,
 * `storage:estimate-pdfs/{path}`, not a link. Whoever is allowed to see the
 * estimate (the office, the client holding the estimate's link, an API key
 * for that company) is handed a signed link that expires.
 *
 * A pdf_url that is still a plain URL (written before this change) is passed
 * through as it was.
 */

export const ESTIMATE_PDF_BUCKET = "estimate-pdfs";
const REF_PREFIX = `storage:${ESTIMATE_PDF_BUCKET}/`;
export const ESTIMATE_PDF_MAX_BYTES = 10 * 1024 * 1024;

/** How long a handed-out link works. Long enough to open and save; short enough that a forwarded link dies. */
export const ESTIMATE_PDF_LINK_SECONDS = 60 * 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export function estimatePdfPath(orgId: string, estimateId: string): string {
  // Both ids go into a storage path; anything but a uuid could walk it.
  if (!UUID.test(orgId) || !UUID.test(estimateId)) {
    throw new Error("estimate pdf: ids must be uuids");
  }
  return `${orgId}/estimates/${estimateId}.pdf`;
}

export function estimatePdfRef(path: string): string {
  return `${REF_PREFIX}${path}`;
}

/** The storage path a stored pdf_url points at, or null for a legacy URL / nothing. */
export function estimatePdfPathFromRef(pdfUrl: string | null | undefined): string | null {
  return pdfUrl && pdfUrl.startsWith(REF_PREFIX) ? pdfUrl.slice(REF_PREFIX.length) : null;
}

/** Check a file someone uploaded is a PDF we will keep. Null when it is fine. */
export async function uploadedPdfProblem(file: Blob & { type?: string }): Promise<string | null> {
  if (file.type && file.type !== "application/pdf") return "Only PDF files are allowed";
  if (file.size > ESTIMATE_PDF_MAX_BYTES) return "PDF must be under 10 MB";
  const { isRealPdf } = await import("@/lib/file-sniff");
  if (!(await isRealPdf(file))) return "That file isn't a PDF";
  return null;
}

/**
 * Download a PDF an API caller pointed at. The SSRF guard resolves the host
 * and refuses private, loopback and metadata addresses; redirects are not
 * followed (a public host could otherwise bounce the fetch inward). Error
 * text is deliberately generic: echoing the upstream status would make this
 * a port scanner.
 */
export async function fetchPdfFromUrl(
  sourceUrl: string,
): Promise<{ blob: Blob; error: null } | { blob: null; error: string }> {
  const { assertSafeOutboundTarget } = await import("@/lib/url-safety");
  const safe = await assertSafeOutboundTarget(sourceUrl);
  if (!safe.ok) return { blob: null, error: `Invalid pdf_url: ${safe.reason}` };
  try {
    const res = await fetch(safe.url, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return { blob: null, error: "Could not fetch a PDF from that URL" };
    if (!(res.headers.get("content-type") ?? "").includes("pdf")) {
      return { blob: null, error: "That URL did not return a PDF" };
    }
    const blob = await res.blob();
    if (blob.size > ESTIMATE_PDF_MAX_BYTES) return { blob: null, error: "PDF must be under 10 MB" };
    const { isRealPdf } = await import("@/lib/file-sniff");
    if (!(await isRealPdf(blob))) return { blob: null, error: "That URL did not return a PDF" };
    return { blob, error: null };
  } catch {
    return { blob: null, error: "Could not fetch a PDF from that URL" };
  }
}

/** Store bytes already checked to be a PDF. Returns the reference to save on the estimate. */
export async function storeEstimatePdf(
  admin: Admin,
  orgId: string,
  estimateId: string,
  body: Blob | ArrayBuffer | Uint8Array,
): Promise<{ ref: string | null; error: string | null }> {
  const path = estimatePdfPath(orgId, estimateId);
  const { error } = await admin.storage.from(ESTIMATE_PDF_BUCKET).upload(path, body, {
    upsert: true,
    contentType: "application/pdf",
  });
  if (error) {
    console.error("[estimate-pdf] upload failed:", error.message);
    return { ref: null, error: "The PDF could not be stored. Try again." };
  }
  return { ref: estimatePdfRef(path), error: null };
}

/** Delete an estimate's PDF, wherever it was stored (the private bucket, and the old public spot). */
export async function removeStoredEstimatePdf(admin: Admin, orgId: string, estimateId: string): Promise<void> {
  const path = estimatePdfPath(orgId, estimateId);
  await Promise.allSettled([
    admin.storage.from(ESTIMATE_PDF_BUCKET).remove([path]),
    admin.storage.from("org-assets").remove([path]),
  ]);
}

/**
 * A link the caller can open now, or null. Call only after deciding the
 * viewer may see this estimate: the link itself is the permission.
 */
export async function estimatePdfLink(
  admin: Admin,
  pdfUrl: string | null | undefined,
  seconds = ESTIMATE_PDF_LINK_SECONDS,
): Promise<string | null> {
  if (!pdfUrl) return null;
  const path = estimatePdfPathFromRef(pdfUrl);
  if (!path) return pdfUrl; // written before 2026-11-11: a plain URL
  const { data, error } = await admin.storage.from(ESTIMATE_PDF_BUCKET).createSignedUrl(path, seconds);
  if (error || !data?.signedUrl) {
    console.error("[estimate-pdf] could not sign a link:", error?.message ?? "no url");
    return null;
  }
  return data.signedUrl;
}
