import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOrgTimezone } from "@/lib/org-timezone";
import { suggestedPayPeriod, type PaySchedule } from "@/lib/pay-schedule";
import { preparePayPeriod, periodHref } from "@/lib/pay-period";
import { notify } from "@/lib/notify";
import { formatCurrencyCents } from "@/lib/format";

/**
 * The morning after a pay period ends, prepare it and tell the owner it's
 * sitting there ready — Brian: "on the sixteenth and on the first, it
 * would give me the previous pay period... calculated for me and ready to
 * go." Setting a pay schedule IS the opt-in; drafts only, notify always,
 * money never moves on autopilot.
 *
 * Idempotent by existence: a period with either half already created is
 * skipped, so the daily cron can run forever without doubling anything.
 * A period with nothing to pay is skipped silently and re-checked daily
 * until hours appear or the next period passes it.
 */
export async function runPayrollAutodraft(): Promise<{
  prepared: number;
  blocked: number;
}> {
  const admin = createSupabaseAdminClient();
  let prepared = 0;
  let blocked = 0;

  const { data: orgs } = (await admin
    .from("organizations")
    .select("id, pay_schedule, pay_anchor" as never)
    .not("pay_schedule", "is", null)) as unknown as {
    data: Array<{
      id: string;
      pay_schedule: string;
      pay_anchor: string | null;
    }> | null;
  };

  for (const org of orgs ?? []) {
    try {
      const tz = await getOrgTimezone(org.id);
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());

      // Always the last COMPLETED window on the org's calendar.
      const p = suggestedPayPeriod(
        org.pay_schedule as PaySchedule,
        org.pay_anchor,
        today,
        null,
      );
      if (!p.complete) continue;

      // Skip when either half already exists for this exact window — a
      // human (or a previous morning) beat us to it.
      const [{ count: empCount }, { count: subCount }] = (await Promise.all([
        admin
          .from("payroll_runs" as never)
          .select("id", { count: "exact", head: true })
          .eq("organization_id" as never, org.id as never)
          .eq("period_start" as never, p.start as never)
          .eq("period_end" as never, p.end as never),
        admin
          .from("subcontractor_pay_runs" as never)
          .select("id", { count: "exact", head: true })
          .eq("organization_id" as never, org.id as never)
          .eq("period_start" as never, p.start as never)
          .eq("period_end" as never, p.end as never),
      ])) as unknown as [{ count: number | null }, { count: number | null }];
      if ((empCount ?? 0) > 0 || (subCount ?? 0) > 0) continue;

      // created_by wants a membership: the org's owner (oldest admin as
      // fallback — an org always has one of the two).
      const { data: ownerRow } = (await admin
        .from("memberships")
        .select("id, role")
        .eq("organization_id", org.id)
        .eq("status", "active")
        .in("role", ["owner", "admin"])
        .order("role", { ascending: false }) // owner sorts after admin — pick below
        .limit(10)) as unknown as {
        data: Array<{ id: string; role: string }> | null;
      };
      const creator =
        (ownerRow ?? []).find((r) => r.role === "owner") ?? (ownerRow ?? [])[0];
      if (!creator) continue;

      const result = await preparePayPeriod({
        organizationId: org.id,
        createdByMembershipId: creator.id,
        periodStart: p.start,
        periodEnd: p.end,
      });

      if (result.ok) {
        prepared += 1;
        const total =
          (result.payroll?.totalCents ?? 0) +
          (result.contractor?.totalCents ?? 0);
        await notify({
          organizationId: org.id,
          audience: "org-management",
          title: "Pay period ready for review",
          body: `${p.start} to ${p.end} — ${formatCurrencyCents(total)} across employees and contractors. Nothing is paid until you finalize.`,
          href: periodHref(p.start, p.end),
        });
      } else if (result.flagged) {
        // Blocked on unreviewed capped shifts. Nag only on the first
        // morning after the period closes — daily repeats would be noise.
        blocked += 1;
        const dayAfterEnd = new Date(`${p.end}T00:00:00Z`);
        dayAfterEnd.setUTCDate(dayAfterEnd.getUTCDate() + 1);
        if (dayAfterEnd.toISOString().slice(0, 10) === today) {
          await notify({
            organizationId: org.id,
            audience: "org-management",
            title: "Payroll is waiting on flagged shifts",
            body: `${result.flagged} shift${result.flagged === 1 ? "" : "s"} need review before the ${p.start}–${p.end} period can be prepared.`,
            href: "/app/timesheets",
          });
        }
      }
      // "nothing unpaid" → silently skip; tomorrow re-checks.
    } catch (err) {
      console.error(`[payroll-autodraft] org ${org.id} failed:`, err);
    }
  }

  return { prepared, blocked };
}
