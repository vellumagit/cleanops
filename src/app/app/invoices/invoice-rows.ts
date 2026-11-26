import "server-only";
import { invoiceDeliveryNote } from "@/lib/invoice-delivery-note";
import type { InvoiceRow } from "./invoices-table";

/**
 * One invoice row for the list, read the same way by the page (the newest
 * 500) and by the search that reaches further back (./search-actions.ts),
 * so a row found either way looks and behaves the same.
 */
export const INVOICE_LIST_SELECT = `
  id,
  number,
  status,
  amount_cents,
  due_date,
  sent_at,
  paid_at,
  created_at,
  auto_send_state,
  auto_send_at,
  client:clients ( name, email, contact_preference, contact_overrides, sms_opted_in )
`;

export type RawInvoiceListRow = {
  id: string;
  number: string | null;
  status: InvoiceRow["status"];
  amount_cents: number;
  due_date: string | null;
  sent_at: string | null;
  paid_at: string | null;
  created_at: string;
  auto_send_state: string | null;
  auto_send_at: string | null;
  client: {
    name: string | null;
    email: string | null;
    contact_preference: string | null;
    contact_overrides: Record<string, unknown> | null;
    sms_opted_in: boolean | null;
  } | null;
};

export function toInvoiceRows(
  data: RawInvoiceListRow[],
  ctx: { timezone: string; orgDefault: Parameters<typeof invoiceDeliveryNote>[0]["orgDefault"]; smsEnabled: boolean },
): InvoiceRow[] {
  return data.map((i) => ({
    id: i.id,
    number: i.number,
    status: i.status,
    amount_cents: i.amount_cents,
    due_date: i.due_date,
    sent_at: i.sent_at,
    paid_at: i.paid_at,
    created_at: i.created_at,
    client_name: i.client?.name ?? "—",
    delivery: invoiceDeliveryNote({
      autoSendState: i.auto_send_state,
      autoSendAt: i.auto_send_at,
      timezone: ctx.timezone,
      status: i.status,
      amountCents: i.amount_cents,
      client: i.client,
      orgDefault: ctx.orgDefault,
      smsEnabled: ctx.smsEnabled,
    }),
  }));
}
