import { describe, expect, it } from "vitest";
import { mergeServerMessages } from "./chat-merge";

type M = { id: string; sender_id: string | null; body: string; created_at: string; attachments: unknown[]; status?: string };
const msg = (id: string, body: string, at: string, over: Partial<M> = {}): M => ({
  id,
  sender_id: "me",
  body,
  created_at: `2026-11-18T10:${at}:00Z`,
  attachments: [],
  ...over,
});

describe("mergeServerMessages", () => {
  it("nothing new from the server: the very same list comes back, so nothing redraws", () => {
    const shown = [msg("a", "hi", "00"), msg("b", "there", "01")];
    expect(mergeServerMessages(shown, [msg("a", "hi", "00"), msg("b", "there", "01")])).toBe(shown);
  });

  it("a message the screen hasn't got is added in time order", () => {
    const shown = [msg("a", "hi", "00"), msg("c", "later", "05")];
    const out = mergeServerMessages(shown, [msg("a", "hi", "00"), msg("b", "between", "02", { sender_id: "them" }), msg("c", "later", "05")]);
    expect(out.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("our own message still sending is replaced by the server's copy, not doubled, and keeps its previews", () => {
    const preview = [{ url: "blob:preview" }];
    const shown = [msg("a", "hi", "00"), msg("local-1", "photo", "03", { status: "sending", attachments: preview })];
    const out = mergeServerMessages(shown, [msg("a", "hi", "00"), msg("real-1", "photo", "03", { attachments: [{ url: null }] })]);
    expect(out.map((m) => m.id)).toEqual(["a", "real-1"]);
    expect(out[1].attachments).toBe(preview);
    expect(out[1].status).toBeUndefined();
  });

  it("a second message still on its way is kept when the first one's refresh arrives", () => {
    const shown = [msg("real-1", "one", "03"), msg("local-2", "two", "04", { status: "sending" })];
    const out = mergeServerMessages(shown, [msg("real-1", "one", "03")]);
    expect(out).toBe(shown);
  });
});
