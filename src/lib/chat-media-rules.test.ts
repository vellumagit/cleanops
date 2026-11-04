import { describe, expect, it } from "vitest";
import {
  CHAT_PHOTOS_PER_MESSAGE,
  chatPhotoType,
  chatPreviewText,
  isChatMediaPath,
  validateChatAttachments,
} from "./chat-media-rules";

const ORG = "11111111-1111-1111-1111-111111111111";
const THREAD = "22222222-2222-2222-2222-222222222222";
const OTHER_THREAD = "33333333-3333-3333-3333-333333333333";
const FILE = "44444444-4444-4444-4444-444444444444.jpg";
const GOOD = `${ORG}/${THREAD}/${FILE}`;

describe("chatPhotoType", () => {
  it("accepts the stored photo types as claimed", () => {
    expect(chatPhotoType("image/jpeg", "a.jpg")).toBe("image/jpeg");
    expect(chatPhotoType("image/png", "a.png")).toBe("image/png");
    expect(chatPhotoType("image/webp", "a.webp")).toBe("image/webp");
    expect(chatPhotoType("image/heic", "a.heic")).toBe("image/heic");
  });

  it("maps the loose claims Android galleries send", () => {
    expect(chatPhotoType("image/heif", "IMG_1.HEIF")).toBe("image/heic");
    expect(chatPhotoType("image/jpg", "x.jpg")).toBe("image/jpeg");
    expect(chatPhotoType("", "IMG_2.jpeg")).toBe("image/jpeg");
    expect(chatPhotoType("application/octet-stream", "photo.PNG")).toBe("image/png");
  });

  it("refuses videos, documents and unknowns", () => {
    expect(chatPhotoType("video/mp4", "clip.mp4")).toBeNull();
    expect(chatPhotoType("application/pdf", "doc.pdf")).toBeNull();
    expect(chatPhotoType("", "noext")).toBeNull();
  });
});

describe("isChatMediaPath", () => {
  it("accepts a path the prepare step would issue", () => {
    expect(isChatMediaPath(GOOD, ORG, THREAD)).toBe(true);
  });

  it("refuses another thread, another org, traversal and odd names", () => {
    expect(isChatMediaPath(`${ORG}/${OTHER_THREAD}/${FILE}`, ORG, THREAD)).toBe(false);
    expect(isChatMediaPath(`${OTHER_THREAD}/${THREAD}/${FILE}`, ORG, THREAD)).toBe(false);
    expect(isChatMediaPath(`${ORG}/${THREAD}/../${FILE}`, ORG, THREAD)).toBe(false);
    expect(isChatMediaPath(`/${GOOD}`, ORG, THREAD)).toBe(false);
    expect(isChatMediaPath(`${ORG}/${THREAD}/evil.exe`, ORG, THREAD)).toBe(false);
    expect(isChatMediaPath(`${ORG}/${THREAD}/${FILE}.exe`, ORG, THREAD)).toBe(false);
    expect(isChatMediaPath("", ORG, THREAD)).toBe(false);
  });
});

describe("validateChatAttachments", () => {
  const one = { path: GOOD, mime: "image/jpeg", size: 1234 };

  it("treats nothing as no attachments", () => {
    expect(validateChatAttachments(undefined, ORG, THREAD)).toEqual({ ok: true, attachments: [] });
    expect(validateChatAttachments(null, ORG, THREAD)).toEqual({ ok: true, attachments: [] });
  });

  it("passes a clean list through and drops a duplicate", () => {
    const r = validateChatAttachments([one, { ...one }], ORG, THREAD);
    expect(r).toEqual({ ok: true, attachments: [one] });
  });

  it("refuses a path from another conversation", () => {
    const r = validateChatAttachments(
      [{ ...one, path: `${ORG}/${OTHER_THREAD}/${FILE}` }],
      ORG,
      THREAD,
    );
    expect(r.ok).toBe(false);
  });

  it("refuses non-photo types, empty and oversize files, and too many", () => {
    expect(validateChatAttachments([{ ...one, mime: "video/mp4" }], ORG, THREAD).ok).toBe(false);
    expect(validateChatAttachments([{ ...one, size: 0 }], ORG, THREAD).ok).toBe(false);
    expect(validateChatAttachments([{ ...one, size: 21 * 1024 * 1024 }], ORG, THREAD).ok).toBe(false);
    const many = Array.from({ length: CHAT_PHOTOS_PER_MESSAGE + 1 }, () => one);
    expect(validateChatAttachments(many, ORG, THREAD).ok).toBe(false);
    expect(validateChatAttachments("nope", ORG, THREAD).ok).toBe(false);
  });
});

describe("chatPreviewText", () => {
  it("prefers the words, trimmed to 80", () => {
    expect(chatPreviewText("  hi  ", 3)).toBe("hi");
    expect(chatPreviewText("x".repeat(100), 0)).toBe("x".repeat(80) + "...");
  });

  it("describes photos when there are no words", () => {
    expect(chatPreviewText("", 1)).toBe("📷 Photo");
    expect(chatPreviewText("   ", 4)).toBe("📷 4 photos");
    expect(chatPreviewText("", 0)).toBe("");
  });
});
