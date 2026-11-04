/**
 * Shrink a photo on the phone before it is uploaded through a server action.
 *
 * Vercel refuses any request body over 4.5 MB before our code runs, and a
 * server action carries the file in its body. A modern Android camera saves
 * 4–8 MB JPEGs (iPhone HEICs are usually 1–3 MB), so photos from Android
 * failed with a bare "unexpected response" while the same flow worked on an
 * iPhone. Resizing to a long edge of 2560 px keeps every detail a job photo
 * needs and lands well under a megabyte or two.
 *
 * Browser-only. Returns the original file when it is already small, when
 * this browser can't decode it (HEIC outside Safari), or when re-encoding
 * would not make it smaller.
 */

/** Uploads through a server action must stay under this (Vercel's cap is 4.5 MB). */
export const SERVER_ACTION_UPLOAD_LIMIT = 4 * 1024 * 1024;

const SMALL_ENOUGH = 1.5 * 1024 * 1024;
const MAX_EDGE = 2560;

export async function shrinkPhoto(file: File): Promise<File> {
  if (file.size <= SMALL_ENOUGH) return file;
  if (typeof createImageBitmap !== "function") return file;

  let bitmap: ImageBitmap;
  try {
    // from-image: honour the camera's rotation tag, or portrait photos
    // come out sideways once the tag is dropped by re-encoding.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  let best: Blob | null = null;
  for (const quality of [0.85, 0.75, 0.6]) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (!blob) break;
    best = blob;
    if (blob.size <= SERVER_ACTION_UPLOAD_LIMIT) break;
  }
  if (!best || best.size >= file.size) return file;

  const base = file.name.replace(/\.[^.]+$/, "") || "photo";
  return new File([best], `${base}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
}
