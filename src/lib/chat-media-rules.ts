/**
 * What may ride along with a chat message. Shared by the composer (to
 * refuse early, on the phone) and the server actions (the actual check).
 * Mirrors the chat-media bucket's own limits (migration 20261105010000).
 */

export const CHAT_MEDIA_BUCKET = "chat-media";

/** Per photo. The bucket refuses anything larger. */
export const CHAT_PHOTO_MAX_BYTES = 20 * 1024 * 1024;

/** Per message. Enough for "here's the kitchen, from four angles". */
export const CHAT_PHOTOS_PER_MESSAGE = 6;

/** What is stored in chat_messages.attachments, one entry per photo. */
export type ChatAttachment = {
  path: string;
  mime: string;
  size: number;
};

const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);

const TYPE_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heic",
};

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

/**
 * The type to store a photo as, or null when it can't be sent. Phones are
 * loose about what they claim (an empty type, "image/heif", "image/jpg"),
 * so an unknown claim falls back to the file's extension.
 */
export function chatPhotoType(claimed: string, fileName: string): string | null {
  const t = (claimed ?? "").toLowerCase();
  if (t === "image/heif") return "image/heic";
  if (t === "image/jpg") return "image/jpeg";
  if (PHOTO_TYPES.has(t)) return t;
  const ext = (fileName ?? "").split(".").pop()?.toLowerCase() ?? "";
  return TYPE_BY_EXT[ext] ?? null;
}

export function chatPhotoExtension(mime: string): string {
  return EXT_BY_TYPE[mime] ?? "bin";
}

/** The storage folder every photo in a thread lives under. */
export function chatMediaPrefix(orgId: string, threadId: string): string {
  return `${orgId}/${threadId}/`;
}

/**
 * Is this a path the prepare step could have issued for this org and
 * thread? Anything else (another thread, another org, a traversal) is
 * refused before the row is written.
 */
export function isChatMediaPath(path: string, orgId: string, threadId: string): boolean {
  if (typeof path !== "string" || path.length === 0 || path.length > 300) return false;
  if (path.includes("..") || path.includes("//") || path.startsWith("/")) return false;
  const prefix = chatMediaPrefix(orgId, threadId);
  if (!path.startsWith(prefix)) return false;
  const name = path.slice(prefix.length);
  return /^[0-9a-f-]{36}\.(jpg|png|webp|heic)$/.test(name);
}

/**
 * The attachments a send may carry, cleaned, or a reason it may not. Pure
 * so the same rule runs in a test and in the server action.
 */
export function validateChatAttachments(
  input: unknown,
  orgId: string,
  threadId: string,
): { ok: true; attachments: ChatAttachment[] } | { ok: false; error: string } {
  if (input == null) return { ok: true, attachments: [] };
  if (!Array.isArray(input)) return { ok: false, error: "Attachments must be a list." };
  if (input.length > CHAT_PHOTOS_PER_MESSAGE) {
    return { ok: false, error: `Up to ${CHAT_PHOTOS_PER_MESSAGE} photos per message.` };
  }
  const out: ChatAttachment[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const a = raw as Partial<ChatAttachment> | null;
    if (!a || typeof a !== "object") return { ok: false, error: "Bad attachment." };
    if (!isChatMediaPath(String(a.path ?? ""), orgId, threadId)) {
      return { ok: false, error: "That photo doesn't belong in this conversation." };
    }
    const mime = String(a.mime ?? "").toLowerCase();
    if (!PHOTO_TYPES.has(mime)) return { ok: false, error: "Only photos can be sent." };
    const size = Number(a.size);
    if (!(size > 0) || size > CHAT_PHOTO_MAX_BYTES) {
      return { ok: false, error: "Photos must be under 20 MB." };
    }
    if (seen.has(a.path as string)) continue;
    seen.add(a.path as string);
    out.push({ path: a.path as string, mime, size });
  }
  return { ok: true, attachments: out };
}

/** The attachments column as stored (jsonb), cleaned to the shape we trust. */
export function parseChatAttachments(raw: unknown): ChatAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatAttachment[] = [];
  for (const a of raw) {
    if (!a || typeof a !== "object") continue;
    const { path, mime, size } = a as Partial<ChatAttachment>;
    if (typeof path !== "string" || typeof mime !== "string") continue;
    out.push({ path, mime, size: Number(size) || 0 });
  }
  return out;
}

/** The push / list preview for a message, when it has no words. */
export function chatPreviewText(body: string, photoCount: number): string {
  const trimmed = body.trim();
  if (trimmed) return trimmed.length > 80 ? trimmed.slice(0, 80) + "..." : trimmed;
  if (photoCount <= 0) return "";
  return photoCount === 1 ? "📷 Photo" : `📷 ${photoCount} photos`;
}
