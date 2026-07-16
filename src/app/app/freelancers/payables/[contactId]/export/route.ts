import { requireMembership } from "@/lib/auth";
import { getOrgTimezone } from "@/lib/org-timezone";
import { formatCurrencyCents, formatDate, formatDateTime, humanizeEnum } from "@/lib/format";
import { getOrgCurrency } from "@/lib/org-currency";
import { getSubcontractorLedger } from "@/lib/subcontractor-payables";
import { type NextRequest } from "next/server";

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

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ contactId: string }> },
) {
  // Auth guard — redirects on failure.
  const membership = await requireMembership(["owner", "admin", "manager"]);
  const { contactId } = await params;

  const [ledger, currency, tz] = await Promise.all([
    getSubcontractorLedger(membership.organization_id, contactId),
    getOrgCurrency(membership.organization_id),
    getOrgTimezone(membership.organization_id),
  ]);

  if (!ledger.contact) {
    return new Response("Subcontractor not found", { status: 404 });
  }
  const name = ledger.contact.name;

  const lines: string[] = [];

  // Header block — who this is and the running totals.
  lines.push("SUBCONTRACTOR STATEMENT");
  lines.push(row("Subcontractor", name));
  lines.push(row("Earned", formatCurrencyCents(ledger.earnedCents, currency)));
  lines.push(row("Paid", formatCurrencyCents(ledger.paidCents, currency)));
  lines.push(
    row("Outstanding", formatCurrencyCents(ledger.outstandingCents, currency)),
  );
  lines.push("");

  // JOBS section.
  lines.push("JOBS");
  lines.push(row("Date", "Service", "Pay"));
  for (const j of ledger.jobs) {
    lines.push(
      row(
        formatDateTime(j.scheduledAt, tz),
        humanizeEnum(j.serviceType),
        formatCurrencyCents(j.payCents, currency),
      ),
    );
  }
  lines.push("");

  // PAYMENTS section.
  lines.push("PAYMENTS");
  lines.push(row("Date", "Amount", "Method", "Reference"));
  for (const p of ledger.payouts) {
    lines.push(
      row(
        formatDate(p.paidOn, tz),
        formatCurrencyCents(p.amountCents, currency),
        p.method,
        p.reference,
      ),
    );
  }

  const csvString = lines.join("\n");
  const safeName = name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "subcontractor";

  return new Response(csvString, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="subcontractor-${safeName}-statement.csv"`,
    },
  });
}
