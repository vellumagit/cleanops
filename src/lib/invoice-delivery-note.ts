import {
  resolveClientChannels,
  type OrgContactDefault,
  type ResolveInput,
} from "@/lib/notification-preferences";

/**
 * Why an invoice that auto-send gave up on ("skipped"/"held") wasn't
 * delivered, in owner-readable words — the "silence is never a mystery" rule.
 *
 * auto_send_state stores no reason (the cron only logs it), so we recompute
 * against the client's CURRENT settings. That's deliberate: the owner acts
 * now, so "what's blocking it now" beats "what blocked it that night" —
 * and when nothing blocks it anymore, the note says exactly that.
 *
 * kind matters for tone: "skipped" is a miss the owner should act on
 * (amber); "held" can be the owner's own Hold button or a disabled
 * auto-send — deliberate either way, so it renders neutral, never as an
 * alarm.
 */

export type DeliveryNoteClient = {
  email: string | null;
  contact_preference: string | null;
  contact_overrides: Record<string, unknown> | null;
  sms_opted_in: boolean | null;
};

export type InvoiceDeliveryNote = {
  kind: "skipped" | "held";
  note: string;
};

export function invoiceDeliveryNote(params: {
  autoSendState: string | null;
  status: string;
  amountCents: number;
  client: DeliveryNoteClient | null;
  /** The org's house default for client notifications. */
  orgDefault: OrgContactDefault;
  /** organizations.sms_enabled — billing texts silently skip while off. */
  smsEnabled: boolean;
}): InvoiceDeliveryNote | null {
  const { autoSendState, status, amountCents, client, orgDefault, smsEnabled } =
    params;

  // Once the invoice left draft (sent by hand, paid, voided), the miss is moot.
  if (status !== "draft") return null;

  if (autoSendState === "held") {
    // Deliberately cause-neutral: "held" is written both by the owner's own
    // per-invoice Hold button and by turning auto-send off — never claim
    // which one happened.
    return {
      kind: "held",
      note: "Auto-send is paused for this invoice — it won't email automatically. Use Send when you're ready.",
    };
  }
  if (autoSendState !== "skipped") return null;

  const skipped = (note: string): InvoiceDeliveryNote => ({
    kind: "skipped",
    note,
  });

  if (amountCents <= 0) {
    return skipped(
      "Auto-send skips $0 invoices — send it manually if you still want it delivered.",
    );
  }
  if (!client) {
    return skipped(
      "Auto-send couldn't deliver this invoice — send it manually.",
    );
  }

  const clientPref = (client.contact_preference ??
    "inherit") as ResolveInput["clientPref"];
  const res = resolveClientChannels({
    orgDefault,
    clientPref,
    overrides: (client.contact_overrides ?? {}) as ResolveInput["overrides"],
    category: "billing",
    event: "invoice_send",
    hasEmail: Boolean(client.email),
    smsOptedIn: Boolean(client.sms_opted_in),
  });

  // Billing is two-channel: email, or text with the hosted invoice link.
  if (res.email) {
    return skipped(
      "Auto-send skipped this earlier, but the client can receive email now — use Send to deliver it.",
    );
  }
  if (res.sms) {
    return smsEnabled
      ? skipped(
          "This client is reachable by text now — new invoices auto-send as a text with their payment link. This one was skipped earlier; use Send to email it instead.",
        )
      : skipped(
          "This client is set to text, but texting isn't turned on for your business yet — send it manually, or finish SMS setup so billing texts can go out.",
        );
  }
  switch (res.reason) {
    case "do_not_contact":
      return skipped(
        "This client is set to Do Not Contact, so it was never sent — deliver it another way.",
      );
    case "muted_by_client":
      return skipped(
        "Invoice delivery is muted for this client — send it manually, or unmute it on their row in the per-client manager.",
      );
    case "category_off":
      if (clientPref === "inherit" && orgDefault === "none") {
        return skipped(
          "Your default client notifications are set to “No notifications” and this client hasn't been given their own settings, so it was never sent — send it manually, or configure them in the per-client manager.",
        );
      }
      return skipped(
        "Billing messages are off for this client, so it was never sent — send it manually.",
      );
    case "no_email_address":
      return skipped(
        "No email on file for this client — add one to their profile, then send.",
      );
    case "sms_not_opted_in":
      return skipped(
        "This client is set to text-only but hasn't opted in to SMS, so nothing sent — send it manually, or send them an opt-in request from their profile.",
      );
    default:
      return skipped(
        "This client has no reachable channel — send it manually.",
      );
  }
}
