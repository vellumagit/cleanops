import { z } from "zod";
import { optionalText, requiredText } from "./common";
import { noCardNumber, CARD_DETECTED_MESSAGE } from "@/lib/card-detection";

/** Free text typed by a user gets the same card-number guard as bookings,
 *  clients, tasks, chat, and the feed. A bug report pasting a real payment
 *  is exactly the kind of accident this catches. */
const noCard = (s: string | undefined | null) => !s || noCardNumber(s);

/**
 * The feedback board — bugs, ideas, and questions traded between the org and
 * the Sollos team, in place of voice messages.
 *
 * The vocabulary is small on purpose. Every extra field is one more thing to
 * fill in on a phone at 7am, and the whole point is that filing an item has
 * to be faster than recording a voice memo or it will not get used.
 */

export const FEEDBACK_KINDS = [
  {
    key: "bug",
    label: "Something's broken",
    blurb: "It did the wrong thing, or nothing at all.",
  },
  {
    key: "idea",
    label: "I wish it did this",
    blurb: "Nothing is broken — it should just work differently.",
  },
  {
    key: "question",
    label: "I have a question",
    blurb: "How does this work, or what should I do here?",
  },
] as const;

export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]["key"];

const KIND_KEYS = FEEDBACK_KINDS.map((k) => k.key) as [
  FeedbackKind,
  ...FeedbackKind[],
];

export function feedbackKindLabel(key: string): string {
  return FEEDBACK_KINDS.find((k) => k.key === key)?.label ?? "Feedback";
}

/**
 * Statuses, in the order work actually travels.
 *
 * `needs_answer` is the one that earns this board its keep: it is the only
 * status that points the other way, at the org rather than at Sollos. Items
 * used to stall for weeks because the answer they needed lived in a question
 * nobody had written down anywhere the person who could answer it would look.
 */
export const FEEDBACK_STATUSES = [
  {
    key: "open",
    label: "Open",
    /** Who the ball is with. */
    ball: "sollos",
    blurb: "Sent to the Sollos team.",
  },
  {
    key: "needs_answer",
    label: "Needs your answer",
    ball: "you",
    blurb: "Sollos can't move until someone here replies.",
  },
  {
    key: "in_progress",
    label: "Being built",
    ball: "sollos",
    blurb: "Picked up and under way.",
  },
  {
    key: "shipped",
    label: "Shipped",
    ball: "none",
    blurb: "Live in the app.",
  },
  {
    key: "closed",
    label: "Closed",
    ball: "none",
    blurb: "Not a bug, or not something we're doing.",
  },
] as const;

export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number]["key"];

const STATUS_KEYS = FEEDBACK_STATUSES.map((s) => s.key) as [
  FeedbackStatus,
  ...FeedbackStatus[],
];

export function feedbackStatusLabel(key: string): string {
  return FEEDBACK_STATUSES.find((s) => s.key === key)?.label ?? key;
}

export function feedbackStatusBall(key: string): "sollos" | "you" | "none" {
  return FEEDBACK_STATUSES.find((s) => s.key === key)?.ball ?? "none";
}

/** Open items are the ones still owed something by somebody. */
export function isFeedbackOpen(status: string): boolean {
  return status !== "shipped" && status !== "closed";
}

/**
 * Filing an item. Deliberately two fields: a one-line title and optional
 * detail. Page, build sha, and browser are captured server-side — asking a
 * cleaner to report their user agent is how you get zero bug reports.
 */
export const FeedbackItemSchema = z.object({
  kind: z.enum(KIND_KEYS).default("bug"),
  title: requiredText("A one-line summary", 200).refine(noCard, {
    message: CARD_DETECTED_MESSAGE,
  }),
  body: optionalText.refine(noCard, { message: CARD_DETECTED_MESSAGE }),
  /** Hidden field: the path the reporter was on when they hit the button.
   *  Empty string coerces to undefined via `trimmed`, so the action can pass
   *  the raw form value straight through. */
  page_context: optionalText,
});

export type FeedbackItemInput = z.infer<typeof FeedbackItemSchema>;

/**
 * A reply, optionally moving the item at the same time.
 *
 * The status change rides along with the reply rather than living in its own
 * control, because the two are the same act: you answer, and in answering you
 * hand the ball back. Splitting them is how boards fill up with items whose
 * last reply says "fixed!" above a status that still reads open.
 */
export const FeedbackReplySchema = z.object({
  body: requiredText("A reply", 4000).refine(noCard, {
    message: CARD_DETECTED_MESSAGE,
  }),
  status: z.enum(STATUS_KEYS).optional(),
});

export type FeedbackReplyInput = z.infer<typeof FeedbackReplySchema>;
