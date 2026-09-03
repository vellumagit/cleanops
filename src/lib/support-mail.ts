import "server-only";

import { sendEmail } from "@/lib/email";

/**
 * One address for everything a customer says TO Sollos.
 *
 * Feedback landed in the org's own notification bell — the right place for
 * the customer's team, the wrong place for the people who build the product,
 * who may not be members of that org at all. Brian: "where does feedback
 * land? can I get an email to support@?" — it landed on Svitlana's bell and
 * nowhere he looks. Same for the assistant's "🚩 Feedback noted" flags,
 * which were saved to a table nobody reads.
 *
 * Best-effort by contract: a support email must never fail the action that
 * produced it. Callers fire-and-forget.
 */

export const SUPPORT_EMAIL = "support@sollos3.com";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function emailSupport(args: {
  subject: string;
  /** Who to reply to — the customer, so answering the email answers them. */
  replyTo?: string | null;
  /** Label → value rows, rendered as text and as an HTML table. */
  fields: Array<[string, string | null | undefined]>;
  /** Free text (the message itself). */
  message?: string | null;
  /** Absolute link back into the app. */
  href?: string | null;
}): Promise<void> {
  try {
    const rows = args.fields.filter(
      ([, v]) => v != null && v !== "",
    ) as Array<[string, string]>;
    const text =
      rows.map(([k, v]) => `${k}: ${v}`).join("\n") +
      (args.message ? `\n\n${args.message}` : "") +
      (args.href ? `\n\n${args.href}` : "");
    const html =
      `<table style="font:14px system-ui;border-collapse:collapse">` +
      rows
        .map(
          ([k, v]) =>
            `<tr><td style="padding:2px 12px 2px 0;color:#666">${escapeHtml(k)}</td><td style="padding:2px 0">${escapeHtml(v)}</td></tr>`,
        )
        .join("") +
      `</table>` +
      (args.message
        ? `<p style="font:14px system-ui;white-space:pre-line">${escapeHtml(args.message)}</p>`
        : "") +
      (args.href
        ? `<p style="font:13px system-ui"><a href="${escapeHtml(args.href)}">${escapeHtml(args.href)}</a></p>`
        : "");
    await sendEmail({
      to: SUPPORT_EMAIL,
      subject: args.subject,
      replyTo: args.replyTo || undefined,
      text,
      html,
    });
  } catch (err) {
    console.error("[support-mail] failed:", err);
  }
}
