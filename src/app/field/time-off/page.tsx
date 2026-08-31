import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { FieldHeader } from "@/components/field-shell";
import { PtoRequestForm } from "./pto-request-form";
import { PtoHistory } from "./pto-history";
import { zonedYmd } from "@/lib/wall-clock";
import { toEngagement } from "@/lib/engagement";
import { getOrgTimezone } from "@/lib/org-timezone";

export const metadata = { title: "Time off" };

/**
 * Time off, on its own page. It lived as the biggest card on the Profile
 * stack; pulling it out gives the request + history room to breathe and
 * lets Profile read like a settings screen instead of a scroll of
 * everything at once.
 */
export default async function FieldTimeOffPage() {
  const membership = await requireMembership();
  const tz = await getOrgTimezone(membership.organization_id);
  const supabase = await createSupabaseServerClient();

  // Engagement decides whether time off is paid PTO (employee) or unpaid
  // unavailability (subcontractor).
  const { data: engRow } = (await supabase
    .from("memberships")
    .select("engagement" as never)
    .eq("id", membership.id)
    .maybeSingle()) as unknown as {
    data: { engagement: string | null } | null;
  };
  const isSubcontractor = toEngagement(engRow?.engagement) === "subcontractor";

  // History — start_date desc puts upcoming requests (the editable ones)
  // on top and history below.
  const admin = createSupabaseAdminClient();
  const { data: ptoHistory } = (await admin
    .from("pto_requests" as never)
    .select("id, start_date, end_date, hours, status, reason, reviewed_at")
    .eq("employee_id" as never, membership.id as never)
    .order("start_date" as never, { ascending: false } as never)
    .limit(20)) as unknown as {
    data: Array<{
      id: string;
      start_date: string;
      end_date: string;
      hours: number;
      status: "pending" | "approved" | "declined" | "cancelled";
      reason: string | null;
      reviewed_at: string | null;
    }> | null;
  };

  return (
    <>
      <FieldHeader
        title="Time off"
        description={
          isSubcontractor
            ? "Marks you unavailable so nothing gets scheduled on you. Unpaid — your manager approves it."
            : "Submit a request for your manager to approve."
        }
      />

      <Link
        href="/field/profile"
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Profile
      </Link>

      <div className="rounded-xl border border-border bg-card p-5">
        <PtoRequestForm isSubcontractor={isSubcontractor} />

        <PtoHistory
          rows={(ptoHistory ?? []).map((req) => ({
            id: req.id,
            start_date: req.start_date,
            end_date: req.end_date,
            hours: Number(req.hours),
            status: req.status,
            reason: req.reason,
          }))}
          todayYmd={zonedYmd(new Date(), tz)}
          hideHours={isSubcontractor}
        />
      </div>
    </>
  );
}
