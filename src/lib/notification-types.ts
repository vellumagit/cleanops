/**
 * Every value public.notification_type accepts, in the order the migrations
 * added them. notifications.type is an ENUM: a type that is not on this list
 * fails the insert with 22P02, and inside a webhook (fail-closed) that error
 * takes the push and email down with it, so the person is told nothing.
 *
 * It has bitten twice. Seven of the first eight types the app sent were
 * never members (found weeks later), and "billing" (refund issued, payment
 * on a voided invoice) was sent from August to November 2026 without being
 * one. Typing notify()'s `type` with this list makes a wrong value a build
 * error; test/db/notification-types.test.ts checks the list against the
 * enum the migrations actually build, so adding a type means a migration
 * and this line, together.
 */
export const NOTIFICATION_TYPES = [
  "review_request",
  "low_inventory",
  "unfilled_shift",
  "general",
  "clock_out_reminder",
  "shift_auto_closed",
  "shift_claimed",
  "unstaffed_past_booking",
  "sms_cap",
  "invoice_auto_send_failed",
  "calendar_disconnected",
  "client_request",
  "job_not_started",
  "job_no_clock_in",
  "feedback",
  "shift_unconfirmed",
  "announcement",
  "billing",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
