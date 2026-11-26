"use server";

import { can } from "@/lib/auth";
import { getActionContext } from "@/lib/actions";
import { getOrgTimezone } from "@/lib/org-timezone";
import { invoiceSearchOr, OLDER_MATCH_LIMIT, searchTokens } from "@/lib/invoice-search";
import { fetchOrgNotificationContext } from "@/app/app/clients/org-contact-default";
import { INVOICE_LIST_SELECT, toInvoiceRows, type RawInvoiceListRow } from "./invoice-rows";
import type { InvoiceRow } from "./invoices-table";

export type InvoiceSearchResult =
  | { ok: true; rows: InvoiceRow[]; more: boolean }
  | { ok: false; error: string };

/**
 * Invoices anywhere in the company's history whose client name or number
 * contains a word typed (lib/invoice-search.ts). The list asks only when it
 * holds the newest 500 and there are more; the rows come back shaped like
 * the page's, under the same archive and client filters.
 */
export async function searchAllInvoicesAction(input: {
  needle: string;
  archived: boolean;
  clientId: string | null;
}): Promise<InvoiceSearchResult> {
  const tokens = searchTokens(String(input?.needle ?? ""));
  if (tokens.length === 0) return { ok: true, rows: [], more: false };

  const { membership, supabase } = await getActionContext();
  if (!can(membership, "invoicing")) return { ok: false, error: "You can't see invoices." };
  const orgId = membership.organization_id;

  try {
    // Clients by name first: the name lives on another table.
    const { data: clients } = (await supabase
      .from("clients")
      .select("id")
      .eq("organization_id", orgId)
      .or(tokens.map((t) => `name.ilike.*${t}*`).join(","))
      .limit(500)) as unknown as { data: Array<{ id: string }> | null };

    let query = supabase
      .from("invoices")
      .select(INVOICE_LIST_SELECT as never)
      .eq("organization_id" as never, orgId as never)
      .or(invoiceSearchOr({ tokens, clientIds: (clients ?? []).map((c) => c.id) }));
    if (input.clientId) query = query.eq("client_id" as never, input.clientId as never);
    query = input.archived
      ? query.not("archived_at" as never, "is" as never, null as never)
      : query.is("archived_at" as never, null as never);

    const { data } = (await query
      .order("created_at", { ascending: false })
      .limit(OLDER_MATCH_LIMIT + 1)) as unknown as { data: RawInvoiceListRow[] | null };

    const found = data ?? [];
    const [{ orgDefault, smsEnabled }, timezone] = await Promise.all([
      fetchOrgNotificationContext(orgId),
      getOrgTimezone(orgId),
    ]);
    return {
      ok: true,
      rows: toInvoiceRows(found.slice(0, OLDER_MATCH_LIMIT), { timezone, orgDefault, smsEnabled }),
      more: found.length > OLDER_MATCH_LIMIT,
    };
  } catch (err) {
    console.error("[invoices] search failed:", err instanceof Error ? err.message : err);
    return { ok: false, error: "Couldn't search older invoices." };
  }
}
