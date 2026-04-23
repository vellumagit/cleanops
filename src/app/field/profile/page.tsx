import Link from "next/link";
import { ChevronRight, GraduationCap, Calendar, CalendarClock } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { FieldHeader } from "@/components/field-shell";
import { ProfileForm } from "./profile-form";
import { PtoRequestForm } from "./pto-request-form";
import { PushToggle } from "@/components/push-prompt";

export const metadata = { title: "Profile" };

export default async function FieldProfilePage() {
  const membership = await requireMembership();
  const supabase = await createSupabaseServerClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, phone")
    .eq("id", membership.profile_id)
    .maybeSingle();

  // PTO history (most recent 5)
  const admin = createSupabaseAdminClient();
  const { data: ptoHistory } = (await admin
    .from("pto_requests" as never)
    .select("id, start_date, end_date, hours, status, reason, reviewed_at")
    .eq("employee_id" as never, membership.id as never)
    .order("start_date" as never, { ascending: false } as never)
    .limit(5) as unknown as {
    data: Array<{
      id: string;
      start_date: string;
      end_date: string;
      hours: number;
      status: "pending" | "approved" | "declined" | "cancelled";
      reason: string | null;
      reviewed_at: string | null;
    }> | null;
  });

  return (
    <>
      <FieldHeader
        title="Profile"
        description="Keep your contact info up to date so your team can reach you."
      />

      <div className="rounded-xl border border-border bg-card p-5">
        <div className="mb-5 flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-xl font-bold">
            {(profile?.full_name ?? "U").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="truncate text-lg font-bold">
              {profile?.full_name ?? "Unnamed crew"}
            </div>
            <div className="text-sm uppercase tracking-wide text-muted-foreground">
              {membership.role} · {membership.organization_name}
            </div>
          </div>
        </div>

        <ProfileForm
          defaults={{
            full_name: profile?.full_name ?? "",
            phone: profile?.phone ?? "",
          }}
        />
      </div>

      {/* Notifications */}
      <div className="mt-5 rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 text-sm font-semibold">Push notifications</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Get alerts on this device for new jobs, messages, and schedule changes — even when the app is in the background.
        </p>
        <PushToggle
          membershipId={membership.id}
          organizationId={membership.organization_id}
        />
      </div>

      {/* Time off request */}
      <div className="mt-5 rounded-xl border border-border bg-card p-5">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          Request time off
        </h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Submit a request for your manager to approve.
        </p>
        <PtoRequestForm />

        {ptoHistory && ptoHistory.length > 0 && (
          <>
            <h3 className="mt-5 mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Recent requests
            </h3>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {ptoHistory.map((req) => {
                const toneClass =
                  req.status === "approved"
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : req.status === "declined"
                      ? "bg-red-500/10 text-red-700 dark:text-red-300"
                      : req.status === "cancelled"
                        ? "bg-muted text-muted-foreground"
                        : "bg-amber-500/10 text-amber-700 dark:text-amber-300";
                return (
                  <li key={req.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-xs">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">
                        {req.start_date}
                        {req.start_date !== req.end_date && ` → ${req.end_date}`}
                      </div>
                      <div className="text-muted-foreground">
                        {req.hours}h
                        {req.reason && ` · ${req.reason}`}
                      </div>
                    </div>
                    <span className={`rounded-md px-2 py-0.5 text-[10px] font-medium uppercase ${toneClass}`}>
                      {req.status}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {/* Quick links */}
      <div className="mt-5 space-y-2">
        <Link
          href="/field/availability"
          className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors active:bg-muted"
        >
          <CalendarClock className="h-5 w-5 text-muted-foreground" />
          <span className="flex-1 text-[15px] font-medium">
            My availability
          </span>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </Link>
        <Link
          href="/field/training"
          className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors active:bg-muted"
        >
          <GraduationCap className="h-5 w-5 text-muted-foreground" />
          <span className="flex-1 text-[15px] font-medium">Training modules</span>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </Link>
      </div>
    </>
  );
}
