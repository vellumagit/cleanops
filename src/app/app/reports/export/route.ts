import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOrgTimezone } from "@/lib/org-timezone";
import { localInputToUtcIso } from "@/lib/validators/common";
import { type NextRequest } from "next/server";

// Per-table cap. A header row is added when the dataset is truncated so the
// downstream reader can see the numbers are partial.
const ROW_LIMIT = 10000;

function centsToDollars(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2);
}

function escapeCsv(value: string | null | undefined): string {
  if (value == null) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function row(...cells: (string | number | null | undefined)[]): string {
  return cells.map((c) => escapeCsv(c == null ? "" : String(c))).join(",");
}

export async function GET(request: NextRequest) {
  // Auth guard — redirects on failure
  const membership = await requireMembership(["owner", "admin"]);

  const { searchParams } = new URL(request.url);

  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setDate(defaultFrom.getDate() - 90);

  const from = searchParams.get("from") || defaultFrom.toISOString().slice(0, 10);
  const to = searchParams.get("to") || now.toISOString().slice(0, 10);

  // Respect the org's timezone for the date-range boundaries (previously
  // hardcoded to UTC, which skewed data for non-Eastern orgs).
  const orgTz = await getOrgTimezone(membership.organization_id);
  const fromIso = localInputToUtcIso(`${from}T00:00:00`, orgTz);
  const toIso = localInputToUtcIso(`${to}T23:59:59`, orgTz);

  const admin = createSupabaseAdminClient();

  const [invoicesResp, bookingsResp] = await Promise.all([
    admin
      .from("invoices")
      .select(
        "invoice_number, status, amount_cents, created_at, paid_at, clients(name)",
        { count: "exact" },
      )
      .eq("organization_id", membership.organization_id)
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .order("created_at", { ascending: true })
      .limit(ROW_LIMIT) as unknown as {
        data: Array<{
          invoice_number: string | null;
          status: string | null;
          amount_cents: number | null;
          created_at: string | null;
          paid_at: string | null;
          clients: { name: string } | null;
        }> | null;
        count: number | null;
      },
    admin
      .from("bookings")
      .select(
        "id, status, service_type, scheduled_at, total_cents, address, clients(name)",
        { count: "exact" },
      )
      .eq("organization_id", membership.organization_id)
      .gte("scheduled_at", fromIso)
      .lte("scheduled_at", toIso)
      .order("scheduled_at", { ascending: true })
      .limit(ROW_LIMIT) as unknown as {
        data: Array<{
          id: string | null;
          status: string | null;
          service_type: string | null;
          scheduled_at: string | null;
          total_cents: number | null;
          address: string | null;
          clients: { name: string } | null;
        }> | null;
        count: number | null;
      },
  ]);

  const invoices = invoicesResp.data;
  const bookings = bookingsResp.data;
  const invoicesTruncated = (invoicesResp.count ?? 0) > ROW_LIMIT;
  const bookingsTruncated = (bookingsResp.count ?? 0) > ROW_LIMIT;

  const lines: string[] = [];

  // Surface any truncation loudly at the top of the file. A spreadsheet-
  // reading user would otherwise have no way to tell the numbers are
  // partial.
  if (invoicesTruncated || bookingsTruncated) {
    lines.push("TRUNCATION WARNING");
    if (invoicesTruncated) {
      lines.push(
        row(
          `Invoices: ${ROW_LIMIT.toLocaleString()} of ${(invoicesResp.count ?? 0).toLocaleString()} rows exported. Narrow the date range for complete data.`,
        ),
      );
    }
    if (bookingsTruncated) {
      lines.push(
        row(
          `Bookings: ${ROW_LIMIT.toLocaleString()} of ${(bookingsResp.count ?? 0).toLocaleString()} rows exported. Narrow the date range for complete data.`,
        ),
      );
    }
    lines.push("");
  }

  // INVOICES section
  lines.push("INVOICES");
  lines.push(
    row(
      "Invoice #",
      "Client",
      "Status",
      "Amount (cents)",
      "Amount",
      "Created",
      "Paid",
    ),
  );

  for (const inv of invoices ?? []) {
    lines.push(
      row(
        inv.invoice_number,
        inv.clients?.name,
        inv.status,
        inv.amount_cents,
        centsToDollars(inv.amount_cents),
        inv.created_at,
        inv.paid_at,
      ),
    );
  }

  // Empty line separator
  lines.push("");

  // BOOKINGS section
  lines.push("BOOKINGS");
  lines.push(
    row(
      "Booking ID",
      "Client",
      "Service",
      "Status",
      "Scheduled",
      "Total (cents)",
      "Total",
      "Address",
    ),
  );

  for (const b of bookings ?? []) {
    lines.push(
      row(
        b.id,
        b.clients?.name,
        b.service_type,
        b.status,
        b.scheduled_at,
        b.total_cents,
        centsToDollars(b.total_cents),
        b.address,
      ),
    );
  }

  const csvString = lines.join("\n");

  return new Response(csvString, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="report-${from}-to-${to}.csv"`,
    },
  });
}
