/**
 * Self-healing reconciler for QuickBooks invoice + payment sync.
 *
 * Clone of sage-reconcile (2026-09-04). Invoices and payments push to
 * QuickBooks best-effort when they happen — fire-and-forget, so a failed push
 * leaves the books short with nothing to correct it. This walks every org
 * with an active QuickBooks connection and retries anything sent-or-later
 * that never got a quickbooks_invoice_id, then every payment on a synced
 * invoice that never got a quickbooks_payment_id. Idempotent — both pushes
 * return the stored id when one exists.
 *
 * Failures that retrying cannot fix (missing address, no matching tax rate,
 * any 4xx) are recorded in the connection's metadata skip-list so one broken
 * invoice doesn't consume a slot on every run forever. They still surface in
 * the response, and `?retry_skipped=1` clears the list once the underlying
 * data or QuickBooks config is fixed.
 *
 * Params (all optional):
 *   ?org_id=<uuid>      reconcile a single org on demand
 *   ?limit=<n>          invoices per org this run (default 25, max 100)
 *   ?retry_skipped=1    ignore and clear the skip-list
 *
 * Auth: Vercel cron sends `Authorization: Bearer <CRON_SECRET>`.
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireCronAuth } from "@/lib/cron-auth";
import {
  getQBConnection,
  mergeQBConnectionMetadata,
  pushInvoiceToQuickBooks,
  pushInvoicePaymentToQuickBooks,
} from "@/lib/quickbooks";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
/** Anything older than this needs a human, not another automated attempt. */
const WINDOW_DAYS = 90;
/** Statuses that mean "this is a real receivable and belongs in the books". */
const SYNCABLE = ["sent", "paid", "partially_paid", "overdue"] as const;

type SkipEntry = { reason: string; at: string };

export async function GET(request: NextRequest) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  const singleOrg = url.searchParams.get("org_id");
  const retrySkipped = url.searchParams.get("retry_skipped") === "1";
  const limit = Math.min(
    Number(url.searchParams.get("limit")) || DEFAULT_LIMIT,
    MAX_LIMIT,
  );

  const admin = createSupabaseAdminClient();

  let orgIds: string[];
  if (singleOrg) {
    orgIds = [singleOrg];
  } else {
    const { data: conns } = (await admin
      .from("integration_connections" as never)
      .select("organization_id")
      .eq("provider" as never, "quickbooks")
      .eq("status" as never, "active")
      .limit(1000)) as unknown as {
      data: Array<{ organization_id: string }> | null;
    };
    orgIds = [...new Set((conns ?? []).map((c) => c.organization_id))];
  }

  // Window anchored on created_at, not sent_at: every invoice has one, so a
  // row with a null sent_at can't slip silently out of the query.
  const cutoff = new Date(
    Date.now() - WINDOW_DAYS * 86_400_000,
  ).toISOString();

  const perOrg: Array<Record<string, unknown>> = [];
  let totalSynced = 0;
  let totalFailed = 0;

  for (const orgId of orgIds) {
    const conn = await getQBConnection(orgId);
    if (!conn) continue;

    const existingSkips = retrySkipped
      ? {}
      : ((conn.metadata ?? {})["reconcile_skip"] as Record<
          string,
          SkipEntry
        > | undefined) ?? {};

    const { data: rows } = (await admin
      .from("invoices")
      .select("id, number")
      .eq("organization_id", orgId)
      .is("quickbooks_invoice_id" as never, null as never)
      .in("status", SYNCABLE)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(limit + Object.keys(existingSkips).length)) as unknown as {
      data: Array<{ id: string; number: string | null }> | null;
    };

    const candidates = (rows ?? [])
      .filter((r) => !existingSkips[r.id])
      .slice(0, limit);

    let synced = 0;
    // Carries the reason, not just the invoice number — otherwise finding out
    // WHY something is stuck means digging in the connection's metadata, which
    // is the same "go read the logs" dead end this integration already had.
    const skipped: Array<{ invoice: string | null; reason: string }> = [];
    const retryable: Array<{ invoice: string | null; reason: string }> = [];
    const newSkips: Record<string, SkipEntry> = {};

    for (const inv of candidates) {
      const result = await pushInvoiceToQuickBooks(inv.id);
      if (result.id) {
        synced++;
        continue;
      }
      const reason = result.error ?? "Unknown error";
      if (result.permanent) {
        newSkips[inv.id] = { reason, at: new Date().toISOString() };
        skipped.push({ invoice: inv.number, reason });
      } else {
        retryable.push({ invoice: inv.number, reason });
      }
    }

    // Prune skips for invoices that have since synced, so a fixed invoice
    // doesn't stay on the list forever.
    const carried: Record<string, SkipEntry> = {};
    if (!retrySkipped) {
      for (const [id, entry] of Object.entries(existingSkips)) {
        carried[id] = entry;
      }
    }
    const mergedSkips = { ...carried, ...newSkips };
    if (
      Object.keys(mergedSkips).length !== Object.keys(existingSkips).length ||
      retrySkipped
    ) {
      await mergeQBConnectionMetadata(orgId, {
        reconcile_skip: mergedSkips,
      });
    }

    // ── Payments ─────────────────────────────────────────────────────
    // Payments for invoices that ARE in QuickBooks but whose payment never got
    // there. Keyed "pay:<id>" on the same skip-list. An invoice still
    // missing from QuickBooks is the invoice pass's problem, not this one's.
    const { data: payRows } = (await admin
      .from("invoice_payments" as never)
      .select("id, invoice:invoices!inner ( number, quickbooks_invoice_id )")
      .eq("organization_id" as never, orgId as never)
      .is("quickbooks_payment_id" as never, null as never)
      .not("invoice.quickbooks_invoice_id" as never, "is" as never, null as never)
      .gte("created_at" as never, cutoff as never)
      .order("created_at" as never, { ascending: false } as never)
      .limit(limit + Object.keys(existingSkips).length)) as unknown as {
      data: Array<{
        id: string;
        invoice: { number: string | null; quickbooks_invoice_id: string | null } | null;
      }> | null;
    };
    const payCandidates = (payRows ?? [])
      .filter((r) => r.invoice?.quickbooks_invoice_id && !existingSkips[`pay:${r.id}`])
      .slice(0, limit);
    let paymentsSynced = 0;
    for (const p of payCandidates) {
      const result = await pushInvoicePaymentToQuickBooks(p.id);
      if (result.id) {
        paymentsSynced++;
        continue;
      }
      const reason = `Payment on ${p.invoice?.number ?? "invoice"}: ${result.error ?? "Unknown error"}`;
      if (result.permanent) {
        mergedSkips[`pay:${p.id}`] = { reason, at: new Date().toISOString() };
        skipped.push({ invoice: p.invoice?.number ?? null, reason });
      } else {
        retryable.push({ invoice: p.invoice?.number ?? null, reason });
      }
    }
    if (
      Object.keys(mergedSkips).length !== Object.keys(existingSkips).length ||
      retrySkipped
    ) {
      await mergeQBConnectionMetadata(orgId, {
        reconcile_skip: mergedSkips,
      });
    }

    totalSynced += synced + paymentsSynced;
    totalFailed += skipped.length + retryable.length;

    perOrg.push({
      organization_id: orgId,
      considered: candidates.length,
      synced,
      payments_considered: payCandidates.length,
      payments_synced: paymentsSynced,
      will_retry: retryable,
      needs_attention: skipped,
      skip_list_size: Object.keys(mergedSkips).length,
    });
  }

  console.log(
    `[cron/quickbooks-reconcile] orgs=${orgIds.length} synced=${totalSynced} failed=${totalFailed}`,
  );

  return NextResponse.json({
    ok: true,
    orgs: orgIds.length,
    synced: totalSynced,
    failed: totalFailed,
    detail: perOrg,
  });
}
