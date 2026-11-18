/**
 * GET /api/pay-invoice/{employee|contractor}/{item id}
 *
 * One person's pay for one pay period, as an invoice PDF (lib/pay-invoice).
 *
 * Who may open it:
 *   - the person it is for, once the run is final (a draft the office is
 *     still reviewing is not theirs to see yet);
 *   - owners and admins of the same company, at any stage;
 *   - a manager, for CONTRACTOR invoices only, and only with the
 *     "On-call pool & subcontractor pay" switch on. Employee payroll is
 *     owner and admin territory everywhere else in the app.
 *
 * Everyone else gets the same 404 as an id that doesn't exist, so the
 * route never confirms that somebody else's invoice is there.
 */

import { NextResponse, type NextRequest } from "next/server";
import { can, getCurrentMembership } from "@/lib/auth";
import { loadPayInvoice, type PayInvoiceKind } from "@/lib/pay-invoice";
import { renderPayInvoicePdf } from "@/lib/pay-invoice-pdf";
import { enterFailClosed } from "@/lib/supabase/query-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => new NextResponse("Not found", { status: 404 });

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ kind: string; itemId: string }> },
) {
  // A money document is never built from a read that failed: a failed read
  // stops the request instead of counting as "no shifts".
  enterFailClosed();
  const membership = await getCurrentMembership();
  if (!membership) return new NextResponse("Sign in to open this.", { status: 401 });

  const { kind, itemId } = await params;
  if ((kind !== "employee" && kind !== "contractor") || !UUID.test(itemId)) return notFound();

  const invoice = await loadPayInvoice(kind as PayInvoiceKind, itemId);
  if (!invoice || invoice.organizationId !== membership.organization_id) return notFound();

  const own = invoice.membershipId === membership.id;
  const office =
    membership.role === "owner" ||
    membership.role === "admin" ||
    (membership.role === "manager" && kind === "contractor" && can(membership, "subcontractors"));
  if (!office && !(own && invoice.runStatus !== "draft")) return notFound();

  const pdf = await renderPayInvoicePdf(invoice);
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="invoice-${invoice.number}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
