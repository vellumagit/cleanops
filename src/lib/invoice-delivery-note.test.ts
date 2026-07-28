import { describe, it, expect } from "vitest";
import { invoiceDeliveryNote } from "./invoice-delivery-note";

const client = {
  email: "c@example.com",
  contact_preference: "custom",
  contact_overrides: { billing: "email" } as Record<string, unknown>,
  sms_opted_in: false,
};

const base = {
  autoSendState: "skipped",
  status: "draft",
  amountCents: 10000,
  client,
  orgDefault: "none" as const,
  smsEnabled: true,
};

describe("invoiceDeliveryNote", () => {
  it("null for anything that isn't a skipped/held draft", () => {
    expect(invoiceDeliveryNote({ ...base, autoSendState: null })).toBeNull();
    expect(
      invoiceDeliveryNote({ ...base, autoSendState: "scheduled" }),
    ).toBeNull();
    expect(invoiceDeliveryNote({ ...base, autoSendState: "sent" })).toBeNull();
    expect(invoiceDeliveryNote({ ...base, status: "sent" })).toBeNull();
    expect(invoiceDeliveryNote({ ...base, status: "paid" })).toBeNull();
  });

  it("held → kind held, cause-neutral copy (owner's Hold button is one producer)", () => {
    const r = invoiceDeliveryNote({ ...base, autoSendState: "held" });
    expect(r?.kind).toBe("held");
    expect(r?.note).toMatch(/paused/);
    expect(r?.note).not.toMatch(/switched off/);
  });

  it("skipped $0 invoice explains the zero-amount rule", () => {
    const r = invoiceDeliveryNote({ ...base, amountCents: 0 });
    expect(r?.kind).toBe("skipped");
    expect(r?.note).toMatch(/\$0/);
  });

  it("skipped but client can receive email NOW → says so", () => {
    expect(invoiceDeliveryNote(base)?.note).toMatch(/can receive email now/);
  });

  it("do-not-contact client", () => {
    expect(
      invoiceDeliveryNote({
        ...base,
        client: { ...client, contact_preference: "do_not_contact" },
      })?.note,
    ).toMatch(/Do Not Contact/);
  });

  it("inherit client under a 'none' house default names the default, not the client", () => {
    const r = invoiceDeliveryNote({
      ...base,
      orgDefault: "none",
      client: {
        ...client,
        contact_preference: "inherit",
        contact_overrides: {},
      },
    });
    expect(r?.note).toMatch(/No notifications/);
    expect(r?.note).toMatch(/per-client manager/);
  });

  it("billing off for the client", () => {
    expect(
      invoiceDeliveryNote({
        ...base,
        client: { ...client, contact_overrides: { billing: "off" } },
      })?.note,
    ).toMatch(/Billing messages are off/);
  });

  it("text-only opted-in client is reachable by text — billing texts exist now", () => {
    expect(
      invoiceDeliveryNote({
        ...base,
        client: {
          ...client,
          sms_opted_in: true,
          contact_overrides: { billing: "sms" },
        },
      })?.note,
    ).toMatch(/reachable by text/);
  });

  it("text-only client but org SMS is off → points at SMS setup", () => {
    expect(
      invoiceDeliveryNote({
        ...base,
        smsEnabled: false,
        client: {
          ...client,
          sms_opted_in: true,
          contact_overrides: { billing: "sms" },
        },
      })?.note,
    ).toMatch(/texting isn't turned on/);
  });

  it("text-only client without SMS opt-in → points at the opt-in request", () => {
    expect(
      invoiceDeliveryNote({
        ...base,
        client: {
          ...client,
          sms_opted_in: false,
          contact_overrides: { billing: "sms" },
        },
      })?.note,
    ).toMatch(/hasn't opted in/);
  });

  it("invoice delivery muted by the client's advanced settings", () => {
    expect(
      invoiceDeliveryNote({
        ...base,
        client: {
          ...client,
          contact_overrides: {
            billing: "email",
            muted_events: ["invoice_send"],
          },
        },
      })?.note,
    ).toMatch(/muted/);
  });

  it("no email on file", () => {
    expect(
      invoiceDeliveryNote({ ...base, client: { ...client, email: null } })
        ?.note,
    ).toMatch(/No email on file/);
  });
});
