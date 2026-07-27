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
  /** Mode-collapsed org default: "none" in per-client mode. */
  orgDefault: OrgContactDefault;
  /** Routing mode — copy differs between "not configured (per-client mode)"
   *  and "your house default is No notifications". */
  perClientMode: boolean;
}): InvoiceDeliveryNote | null {
  const { autoSendState, status, amountCents, client, orgDefault, perClientMode } =
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

  // Invoices only exist as email, so res.email is the whole question.
  if (res.email) {
    return skipped(
      "Auto-send skipped this earlier, but the client can receive email now — use Send to deliver it.",
    );
  }
  switch (res.reason) {
    case "do_not_contact":
      return skipped(
        "This client is set to Do Not Contact, so it was never emailed — deliver it another way.",
      );
    case "muted_by_client":
      return skipped(
        "Invoice delivery is muted for this client — send it manually, or unmute it on their row in the per-client manager.",
      );
    case "category_off":
      if (clientPref === "inherit" && perClientMode) {
        return skipped(
          "This client isn't configured for messages yet (per-client mode), so it was never emailed — send it manually.",
        );
      }
      if (clientPref === "inherit" && orgDefault === "none") {
        return skipped(
          "Your default client notifications are set to “No notifications”, so it was never emailed — send it manually, or change the default in Settings → Automations.",
        );
      }
      return skipped(
        "Billing messages are off for this client, so it was never emailed — send it manually.",
      );
    case "no_email_address":
      return skipped(
        "No email on file for this client — add one to their profile, then send.",
      );
    default:
      if (res.sms) {
        return clientPref === "inherit"
          ? skipped(
              "Your default client notifications are “Text only”, and invoices only exist as email — send it manually, or change the default in Settings → Automations.",
            )
          : skipped(
              "This client is set to text-only, and invoices only exist as email — send it manually or switch their billing setting to email.",
            );
      }
      return skipped(
        "This client has no reachable channel — send it manually.",
      );
  }
}
