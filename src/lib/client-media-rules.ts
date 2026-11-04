/**
 * What may be attached to a client as a home photo or video. Shared by the
 * upload card (to refuse early, on the phone) and the server actions (the
 * actual check). Mirrors the client-media bucket's own limits
 * (migration 20261103010000).
 */

export const CLIENT_MEDIA_BUCKET = "client-media";

/** Per file. The bucket refuses anything larger. */
export const CLIENT_MEDIA_MAX_BYTES = 50 * 1024 * 1024;

export const CLIENT_MEDIA_TYPES: Record<string, "photo" | "video"> = {
  "image/jpeg": "photo",
  "image/png": "photo",
  "image/webp": "photo",
  "image/heic": "photo",
  "video/mp4": "video",
  "video/quicktime": "video",
  "video/webm": "video",
  "video/3gpp": "video",
};

const TYPE_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heic",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  "3gp": "video/3gpp",
};

/**
 * The type to store a file as, or null when it can't be attached. Phones
 * are loose about what they claim (an empty type, "image/heif",
 * "image/jpg"), so an unknown claim falls back to the file's extension.
 */
export function clientMediaType(claimed: string, fileName: string): string | null {
  const t = claimed.toLowerCase();
  if (t === "image/heif") return "image/heic";
  if (t === "image/jpg") return "image/jpeg";
  if (CLIENT_MEDIA_TYPES[t]) return t;
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return TYPE_BY_EXT[ext] ?? null;
}

export function formatMediaSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
