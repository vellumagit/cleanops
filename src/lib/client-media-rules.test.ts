import { describe, it, expect } from "vitest";
import { clientMediaType, formatMediaSize } from "./client-media-rules";

describe("clientMediaType: what phones actually send", () => {
  it("takes a known type as given", () => {
    expect(clientMediaType("image/jpeg", "a.jpg")).toBe("image/jpeg");
    expect(clientMediaType("video/mp4", "a.mp4")).toBe("video/mp4");
    expect(clientMediaType("video/quicktime", "IMG_1.MOV")).toBe("video/quicktime");
  });
  it("normalises the loose names Android galleries use", () => {
    expect(clientMediaType("image/heif", "x.heif")).toBe("image/heic");
    expect(clientMediaType("image/jpg", "x.jpg")).toBe("image/jpeg");
  });
  it("falls back to the extension when the type is empty", () => {
    expect(clientMediaType("", "IMG_2041.HEIC")).toBe("image/heic");
    expect(clientMediaType("", "clip.mov")).toBe("video/quicktime");
    expect(clientMediaType("", "VID_20261103.3gp")).toBe("video/3gpp");
  });
  it("refuses what isn't a photo or video", () => {
    expect(clientMediaType("application/pdf", "quote.pdf")).toBeNull();
    expect(clientMediaType("", "notes.txt")).toBeNull();
    expect(clientMediaType("application/octet-stream", "run.exe")).toBeNull();
  });
});

describe("formatMediaSize", () => {
  it("reads in KB under a megabyte and MB above", () => {
    expect(formatMediaSize(500)).toBe("1 KB");
    expect(formatMediaSize(300 * 1024)).toBe("300 KB");
    expect(formatMediaSize(52 * 1024 * 1024)).toBe("52.0 MB");
  });
});
