import "server-only";

/**
 * What a file IS, from its first bytes — never from `file.type`, which the
 * browser copies from the client and an attacker sets to anything.
 *
 * Branding and job photos have checked bytes since 2026-08; the feed,
 * training steps, estimate PDFs, employee documents and contractor bills
 * trusted the label until 2026-09-13, and org-assets is a public bucket.
 */
export const RASTER_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

/** Document types a business keeps on file: PDF, images, office, plain text. */
export const DOCUMENT_TYPES = [
  ...RASTER_TYPES,
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

async function head(file: File, n: number): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, n).arrayBuffer());
}

/** The bytes match the raster format the label claims. */
export async function isRealRasterImage(file: File, claimed: string): Promise<boolean> {
  const h = await head(file, 12);
  if (h.length < 12) return false;
  const u32 = (i: number) => ((h[i] << 24) | (h[i + 1] << 16) | (h[i + 2] << 8) | h[i + 3]) >>> 0;
  switch (claimed) {
    case "image/jpeg":
      return h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff;
    case "image/png":
      return (
        h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47 &&
        h[4] === 0x0d && h[5] === 0x0a && h[6] === 0x1a && h[7] === 0x0a
      );
    case "image/webp":
      return u32(0) === 0x52494646 && u32(8) === 0x57454250; // "RIFF"…"WEBP"
    case "image/gif":
      return u32(0) === 0x47494638 && (h[4] === 0x37 || h[4] === 0x39) && h[5] === 0x61; // GIF87a / GIF89a
    default:
      return false;
  }
}

export async function isRealPdf(file: File | Blob): Promise<boolean> {
  const h = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  return h.length === 5 && h[0] === 0x25 && h[1] === 0x50 && h[2] === 0x44 && h[3] === 0x46 && h[4] === 0x2d; // %PDF-
}

/**
 * A document upload: the label must be on the list, and where the bytes
 * can be checked (images, PDF) they must agree. Office and text files
 * are stored as what they claim; the bucket's own allowlist backstops.
 */
export async function isAcceptableDocument(file: File): Promise<{ ok: true; type: string } | { ok: false; error: string }> {
  const type = file.type || "application/octet-stream";
  if (!(DOCUMENT_TYPES as readonly string[]).includes(type)) {
    return { ok: false, error: "Upload a PDF, image, Word, Excel, or text file." };
  }
  if ((RASTER_TYPES as readonly string[]).includes(type) && !(await isRealRasterImage(file, type))) {
    return { ok: false, error: "That file isn't the image it claims to be." };
  }
  if (type === "application/pdf" && !(await isRealPdf(file))) {
    return { ok: false, error: "That file isn't a PDF." };
  }
  return { ok: true, type };
}

/** The extension the stored object gets: letters and digits only, from the label, never the filename. */
export function extensionFor(type: string, fallback = "bin"): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "application/pdf": "pdf",
  };
  return map[type] ?? fallback;
}
