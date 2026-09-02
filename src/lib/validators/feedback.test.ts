import { describe, it, expect } from "vitest";
import {
  FeedbackItemSchema,
  FeedbackReplySchema,
  FEEDBACK_STATUSES,
  feedbackStatusBall,
  feedbackStatusLabel,
  isFeedbackOpen,
} from "./feedback";

describe("FeedbackItemSchema", () => {
  it("accepts a bare report — title only", () => {
    const r = FeedbackItemSchema.safeParse({
      kind: "bug",
      title: "Invoice total is wrong on recurring jobs",
      body: "",
      page_context: "",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      // "" must land as undefined, not "" and not null: the action writes
      // these straight into nullable columns, and an empty-string page
      // context would render as a chip pointing nowhere.
      expect(r.data.body).toBeUndefined();
      expect(r.data.page_context).toBeUndefined();
    }
  });

  it("rejects null for the optional fields", () => {
    // The regression this file exists for. The action originally coerced
    // blank textareas to null with `String(...) || null`; zod's .optional()
    // does not accept null, so every report filed without detail failed
    // validation on a field the reporter never touched.
    expect(
      FeedbackItemSchema.safeParse({
        kind: "bug",
        title: "Something broke",
        body: null,
        page_context: null,
      }).success,
    ).toBe(false);
  });

  it("requires a title", () => {
    const r = FeedbackItemSchema.safeParse({
      kind: "bug",
      title: "   ",
      body: "",
      page_context: "",
    });
    expect(r.success).toBe(false);
  });

  it("defaults to a bug when no kind is posted", () => {
    const r = FeedbackItemSchema.safeParse({ title: "x", body: "", page_context: "" });
    expect(r.success && r.data.kind).toBe("bug");
  });

  it("catches a card number pasted into the detail box", () => {
    const r = FeedbackItemSchema.safeParse({
      kind: "bug",
      title: "Payment failed",
      body: "the card 4242 4242 4242 4242 was declined",
      page_context: "",
    });
    expect(r.success).toBe(false);
  });
});

describe("FeedbackReplySchema", () => {
  it("takes a reply with no status change", () => {
    const r = FeedbackReplySchema.safeParse({ body: "Fixed, thanks" });
    expect(r.success).toBe(true);
    expect(r.success && r.data.status).toBeUndefined();
  });

  it("rejects an empty reply", () => {
    expect(FeedbackReplySchema.safeParse({ body: "  " }).success).toBe(false);
  });

  it("rejects a status that isn't one of ours", () => {
    expect(
      FeedbackReplySchema.safeParse({ body: "ok", status: "wontfix" }).success,
    ).toBe(false);
  });
});

describe("status vocabulary", () => {
  it("has exactly one status that points at the org", () => {
    // The board's whole premise. If a second status ever means "waiting on
    // you", the "Needs your answer" section stops being the complete list of
    // things only this org can unblock.
    const theirs = FEEDBACK_STATUSES.filter((s) => s.ball === "you");
    expect(theirs.map((s) => s.key)).toEqual(["needs_answer"]);
  });

  it("treats shipped and closed as finished, everything else as live", () => {
    expect(isFeedbackOpen("open")).toBe(true);
    expect(isFeedbackOpen("needs_answer")).toBe(true);
    expect(isFeedbackOpen("in_progress")).toBe(true);
    expect(isFeedbackOpen("shipped")).toBe(false);
    expect(isFeedbackOpen("closed")).toBe(false);
  });

  it("labels every status and falls back to the raw key", () => {
    for (const s of FEEDBACK_STATUSES) {
      expect(feedbackStatusLabel(s.key)).toBe(s.label);
    }
    expect(feedbackStatusLabel("nonsense")).toBe("nonsense");
    expect(feedbackStatusBall("nonsense")).toBe("none");
  });
});
