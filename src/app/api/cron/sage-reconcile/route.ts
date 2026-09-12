/**
 * Self-healing reconciler for Sage invoice sync.
 *
 * Invoices push to Sage best-effort when they're sent — fire-and-forget, so a
 * failed push (token blip, a payload Sage refuses, Sage briefly down) leaves
 * the invoice missing from the books with nothing to correct it. That is not
 * hypothetical: six sent invoices totalling $1,713 sat unsynced because the
 * background push 422'd, logged, and vanished.
 *
 * This walks every org with an active Sage connection and retries anything
 * sent-or-later that never got a sage_invoice_id. Idempotent — pushInvoiceToSage
 * returns the existing id when one is already stored, so a double run cannot
 * double-book an invoice.
 *
 * Failures that retrying cannot fix (missing address, no matching tax rate,
 * any 4xx) are recorded in the connection's metadata skip-list so one broken
 * invoice doesn't consume a slot on every run forever. They still surface in
 * the response, and `?retry_skipped=1` clears the list once the underlying
 * data or Sage config is fixed.
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
  getSageConnection,
  mergeSageConnectionMetadata,
  pushInvoiceToSage,
  pushInvoicePaymentToSage,
  pushPayrollRunToSage,
  syncContractorStatementToSage,
  pushInvoiceRefundToSage,
  syncTipToSage,
} from "@/lib/sage";

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
      .eq("provider" as never, "sage")
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
    const conn = await getSageConnection(orgId);
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
      .is("sage_invoice_id" as never, null as never)
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
      const result = await pushInvoiceToSage(inv.id);
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
      await mergeSageConnectionMetadata(orgId, {
        reconcile_skip: mergedSkips,
      });
    }

    // ── Payments ─────────────────────────────────────────────────────
    // Receipts for invoices that ARE in Sage but whose payment never got
    // there. Keyed "pay:<id>" on the same skip-list. An invoice still
    // missing from Sage is the invoice pass's problem, not this one's.
    const { data: payRows } = (await admin
      .from("invoice_payments" as never)
      .select("id, invoice:invoices!inner ( number, sage_invoice_id )")
      .eq("organization_id" as never, orgId as never)
      .is("sage_payment_id" as never, null as never)
      .not("invoice.sage_invoice_id" as never, "is" as never, null as never)
      .gte("created_at" as never, cutoff as never)
      .order("created_at" as never, { ascending: false } as never)
      .limit(limit + Object.keys(existingSkips).length)) as unknown as {
      data: Array<{
        id: string;
        invoice: { number: string | null; sage_invoice_id: string | null } | null;
      }> | null;
    };
    const payCandidates = (payRows ?? [])
      .filter((r) => r.invoice?.sage_invoice_id && !existingSkips[`pay:${r.id}`])
      .slice(0, limit);
    let paymentsSynced = 0;
    for (const p of payCandidates) {
      const result = await pushInvoicePaymentToSage(p.id);
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
      await mergeSageConnectionMetadata(orgId, {
        reconcile_skip: mergedSkips,
      });
    }

    // ── Payroll ──────────────────────────────────────────────────────
    // Paid runs and statements with no journal yet. Keyed "run:<id>" /
    // "srun:<id>" on the same skip-list.
    let runsSynced = 0;
    // Employee runs: a gross-wages journal per paid run.
    {
      const { data: runRows } = (await admin
        .from("payroll_runs")
        .select("id, period_start, period_end")
        .eq("organization_id", orgId)
        .eq("status", "paid")
        .is("sage_journal_id" as never, null as never)
        .gte("paid_at", cutoff)
        .order("paid_at", { ascending: false })
        .limit(limit + Object.keys(existingSkips).length)) as unknown as {
        data: Array<{ id: string; period_start: string; period_end: string }> | null;
      };
      const runCandidates = (runRows ?? [])
        .filter((r) => !existingSkips[`run:${r.id}`])
        .slice(0, limit);
      for (const r of runCandidates) {
        const result = await pushPayrollRunToSage(r.id, "employee");
        if (result.id) {
          runsSynced++;
          continue;
        }
        const label = `Payroll ${r.period_start}–${r.period_end}`;
        const reason = `${label}: ${result.error ?? "Unknown error"}`;
        if (result.permanent) {
          mergedSkips[`run:${r.id}`] = { reason, at: new Date().toISOString() };
          skipped.push({ invoice: label, reason });
        } else {
          retryable.push({ invoice: label, reason });
        }
      }
    }
    // Contractor statements: bills per line at finalize, supplier payments
    // once paid. One idempotent sync per statement decides what's missing.
    {
      const { data: stRows } = (await admin
        .from("subcontractor_pay_runs" as never)
        .select("id, period_start, period_end, status, items:subcontractor_pay_items ( sage_purchase_invoice_id, sage_payment_id, total_cents )")
        .eq("organization_id" as never, orgId as never)
        .in("status" as never, ["finalized", "paid"] as never)
        .gte("created_at" as never, cutoff as never)
        .order("created_at" as never, { ascending: false } as never)
        .limit(limit + Object.keys(existingSkips).length)) as unknown as {
        data: Array<{
          id: string;
          period_start: string;
          period_end: string;
          status: string;
          items: Array<{ sage_purchase_invoice_id: string | null; sage_payment_id: string | null; total_cents: number }> | null;
        }> | null;
      };
      const stCandidates = (stRows ?? [])
        .filter((r) => !existingSkips[`srun:${r.id}`])
        .filter((r) =>
          (r.items ?? []).some(
            (i) =>
              i.total_cents > 0 &&
              (!i.sage_purchase_invoice_id || (r.status === "paid" && !i.sage_payment_id)),
          ),
        )
        .slice(0, limit);
      for (const r of stCandidates) {
        const result = await syncContractorStatementToSage(r.id);
        if (result.ok) {
          if (result.billsPosted || result.paymentsPosted) runsSynced++;
          continue;
        }
        const label = `Contractor pay ${r.period_start}–${r.period_end}`;
        const reason = `${label}: ${result.error ?? "Unknown error"}`;
        if (result.permanent) {
          mergedSkips[`srun:${r.id}`] = { reason, at: new Date().toISOString() };
          skipped.push({ invoice: label, reason });
        } else {
          retryable.push({ invoice: label, reason });
        }
      }
    }
    if (
      Object.keys(mergedSkips).length !== Object.keys(existingSkips).length ||
      retrySkipped
    ) {
      await mergeSageConnectionMetadata(orgId, {
        reconcile_skip: mergedSkips,
      });
    }

    // ── Refunds ──────────────────────────────────────────────────────
    // Payments refunded further than Sage has seen. Keyed "ref:<id>".
    let refundsSynced = 0;
    {
      const { data: refRows } = (await admin
        .from("invoice_payments" as never)
        .select("id, refunded_cents, sage_refunded_cents, invoice:invoices!inner ( number, sage_invoice_id )")
        .eq("organization_id" as never, orgId as never)
        .gt("refunded_cents" as never, 0 as never)
        .gte("created_at" as never, cutoff as never)
        .limit(200)) as unknown as {
        data: Array<{ id: string; refunded_cents: number; sage_refunded_cents: number | null; invoice: { number: string | null; sage_invoice_id: string | null } | null }> | null;
      };
      const refCandidates = (refRows ?? [])
        .filter((r) => r.refunded_cents > (r.sage_refunded_cents ?? 0) && !existingSkips[`ref:${r.id}`])
        .slice(0, limit);
      for (const r of refCandidates) {
        const result = await pushInvoiceRefundToSage(r.id);
        if (result.postedCents > 0) {
          refundsSynced++;
          continue;
        }
        if (!result.error) continue;
        const label = `Refund on ${r.invoice?.number ?? "invoice"}`;
        const reason = `${label}: ${result.error}`;
        if (result.permanent) {
          mergedSkips[`ref:${r.id}`] = { reason, at: new Date().toISOString() };
          skipped.push({ invoice: label, reason });
        } else {
          retryable.push({ invoice: label, reason });
        }
      }
    }

    // ── Tips ─────────────────────────────────────────────────────────
    // Held tips missing their receipt journal, or settled ones missing
    // the settle journal. Keyed "tip:<id>".
    let tipsSynced = 0;
    {
      const { data: tipRows } = (await admin
        .from("invoice_tips" as never)
        .select("id, amount_cents, custody, paid_out_at, sage_receipt_journal_id, sage_settle_journal_id, invoice:invoices ( number )")
        .eq("organization_id" as never, orgId as never)
        .eq("custody" as never, "held" as never)
        .gte("created_at" as never, cutoff as never)
        .limit(300)) as unknown as {
        data: Array<{ id: string; amount_cents: number; custody: string; paid_out_at: string | null; sage_receipt_journal_id: string | null; sage_settle_journal_id: string | null; invoice: { number: string | null } | null }> | null;
      };
      const tipCandidates = (tipRows ?? [])
        .filter((t) => t.amount_cents > 0 && !existingSkips[`tip:${t.id}`])
        .filter((t) => !t.sage_receipt_journal_id || (t.paid_out_at && !t.sage_settle_journal_id))
        .slice(0, limit);
      for (const t of tipCandidates) {
        const result = await syncTipToSage(t.id);
        if (result.ok) {
          if (result.posted) tipsSynced++;
          continue;
        }
        const label = `Tip on ${t.invoice?.number ?? "invoice"}`;
        const reason = `${label}: ${result.error ?? "Unknown error"}`;
        if (result.permanent) {
          mergedSkips[`tip:${t.id}`] = { reason, at: new Date().toISOString() };
          skipped.push({ invoice: label, reason });
        } else {
          retryable.push({ invoice: label, reason });
        }
      }
    }

    totalSynced += synced + paymentsSynced + runsSynced + refundsSynced + tipsSynced;
    totalFailed += skipped.length + retryable.length;

    perOrg.push({
      organization_id: orgId,
      considered: candidates.length,
      synced,
      payments_considered: payCandidates.length,
      payments_synced: paymentsSynced,
      payroll_runs_synced: runsSynced,
      refunds_synced: refundsSynced,
      tips_synced: tipsSynced,
      will_retry: retryable,
      needs_attention: skipped,
      skip_list_size: Object.keys(mergedSkips).length,
    });
  }

  console.log(
    `[cron/sage-reconcile] orgs=${orgIds.length} synced=${totalSynced} failed=${totalFailed}`,
  );

  return NextResponse.json({
    ok: true,
    orgs: orgIds.length,
    synced: totalSynced,
    failed: totalFailed,
    detail: perOrg,
  });
}
