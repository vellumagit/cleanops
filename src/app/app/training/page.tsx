import Link from "next/link";
import { Plus } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { memberDisplayName } from "@/lib/member-display";
import { TrainingTable, type TrainingRow } from "./training-table";
import { getOrgTimezone } from "@/lib/org-timezone";

export const metadata = { title: "Training" };

export default async function TrainingPage() {
  const membership = await requireMembership(["owner", "admin", "manager"]);
  const tz = await getOrgTimezone(membership.organization_id);
  const supabase = await createSupabaseServerClient();

  // Active roster + every assignment, for the by-employee rollup below the
  // module table. Fired alongside the modules query.
  const rosterPromise = supabase
    .from("memberships")
    .select("id, display_name, profile:profiles ( full_name )")
    .eq("status", "active")
    .eq("organization_id", membership.organization_id) as unknown as Promise<{
    data: Array<{
      id: string;
      display_name: string | null;
      profile: { full_name: string | null } | null;
    }> | null;
  }>;
  const assignmentsPromise = supabase
    .from("training_assignments")
    .select(
      "employee_id, completed_at, certification_expires_at, module:training_modules ( id, title )",
    )
    .eq(
      "organization_id",
      membership.organization_id,
    ) as unknown as Promise<{
    data: Array<{
      employee_id: string;
      completed_at: string | null;
      certification_expires_at: string | null;
      module: { id: string; title: string } | null;
    }> | null;
  }>;

  const { data, error } = await supabase
    .from("training_modules")
    .select(
      `
        id,
        title,
        description,
        created_at,
        status,
        steps:training_steps ( id ),
        assignments:training_assignments ( id, completed_at )
      ` as never,
    )
    // Explicit org scope — a two-org admin reads both orgs via RLS alone
    // (see multi-org bleed, fixed on Timesheets 2026-08-29).
    .eq("organization_id", membership.organization_id)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw error;

  const [{ data: roster }, { data: allAssignments }] = await Promise.all([
    rosterPromise,
    assignmentsPromise,
  ]);

  // Roll assignments up per person: who's fully trained, who has modules
  // outstanding. Every other surface here is module-centric; this is the
  // "is Marharyta trained?" answer without opening each module. An expired
  // certification is NOT current — the whole point of expiry is that the
  // green fades.
  const nowIso = new Date().toISOString();
  const employeeRollup = (roster ?? [])
    .map((m) => {
      const mine = (allAssignments ?? []).filter(
        (a) => a.employee_id === m.id && a.module,
      );
      const isCurrent = (a: (typeof mine)[number]) =>
        !!a.completed_at &&
        (!a.certification_expires_at || a.certification_expires_at > nowIso);
      const outstanding = mine
        .filter((a) => !a.completed_at)
        .map((a) => a.module!)
        .sort((a, b) => a.title.localeCompare(b.title));
      const expired = mine
        .filter((a) => a.completed_at && !isCurrent(a))
        .map((a) => a.module!)
        .sort((a, b) => a.title.localeCompare(b.title));
      return {
        id: m.id,
        name: memberDisplayName(m),
        assigned: mine.length,
        completed: mine.filter(isCurrent).length,
        outstanding,
        expired,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const rows: TrainingRow[] = (
    (data ?? []) as unknown as Array<{
      id: string;
      title: string;
      description: string | null;
      created_at: string;
      status: string | null;
      steps: Array<{ id: string }> | null;
      assignments: Array<{ id: string; completed_at: string | null }> | null;
    }>
  ).map((m) => {
    const assigned = m.assignments?.length ?? 0;
    const completed =
      m.assignments?.filter((a) => a.completed_at != null).length ?? 0;
    return {
      id: m.id,
      title: m.title,
      description: m.description,
      created_at: m.created_at,
      status: m.status ?? "draft",
      step_count: m.steps?.length ?? 0,
      assigned,
      completed,
    };
  });

  return (
    <PageShell
      title="Training"
      description="Build training modules for your team."
      actions={
        <Link
          href="/app/training/new"
          className="inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-xs font-medium text-background hover:opacity-90 transition-opacity"
        >
          <Plus className="h-3.5 w-3.5" />
          New module
        </Link>
      }
    >
      <div className="space-y-6">
        <TrainingTable tz={tz} rows={rows} />

        {/* By employee — the cross-module answer. */}
        <div className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">By employee</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Who has finished their assigned modules, and what&apos;s still
              outstanding. Click a name for their full file.
            </p>
          </div>
          {employeeRollup.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">
              No active employees yet.
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {employeeRollup.map((emp) => (
                <li
                  key={emp.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5"
                >
                  <Link
                    href={`/app/employees/${emp.id}`}
                    className="min-w-[10rem] text-sm font-medium hover:underline"
                  >
                    {emp.name}
                  </Link>
                  <span
                    className={
                      emp.assigned > 0 && emp.completed === emp.assigned
                        ? "text-xs font-medium text-emerald-600 dark:text-emerald-400"
                        : "text-xs text-muted-foreground"
                    }
                  >
                    {emp.assigned === 0
                      ? "Nothing assigned"
                      : `${emp.completed}/${emp.assigned} complete`}
                  </span>
                  {(emp.outstanding.length > 0 || emp.expired.length > 0) && (
                    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {emp.outstanding.map((m) => (
                        <Link
                          key={m.id}
                          href={`/app/training/${m.id}`}
                          className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 hover:bg-amber-500/20 dark:text-amber-400"
                        >
                          {m.title}
                        </Link>
                      ))}
                      {emp.expired.map((m) => (
                        <Link
                          key={m.id}
                          href={`/app/training/${m.id}`}
                          className="rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-700 hover:bg-red-500/20 dark:text-red-400"
                          title="Certification expired"
                        >
                          {m.title} — expired
                        </Link>
                      ))}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </PageShell>
  );
}
