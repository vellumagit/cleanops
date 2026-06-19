import Link from "next/link";
import { Inbox, Mail, Phone, Briefcase } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getOrgTimezone } from "@/lib/org-timezone";
import { formatDateTime } from "@/lib/format";
import { ApplicantQuickStatus } from "./applicant-quick-status";

export const metadata = { title: "Applicants" };

type Row = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  position: string | null;
  status: string;
  created_at: string;
};

const PIPELINE = [
  { key: "new", label: "New" },
  { key: "reviewing", label: "Reviewing" },
  { key: "interview", label: "Interview" },
  { key: "hired", label: "Hired" },
  { key: "rejected", label: "Rejected" },
] as const;

export const STATUS_TONE: Record<string, string> = {
  new: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  reviewing: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  interview: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  hired: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  rejected: "bg-muted text-muted-foreground",
};

export default async function ApplicantsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const membership = await requireMembership(["owner", "admin"]);
  const supabase = await createSupabaseServerClient();
  const tz = await getOrgTimezone(membership.organization_id);
  const { status: statusFilter } = await searchParams;

  const { data } = (await supabase
    .from("job_applicants" as never)
    .select("id, name, email, phone, position, status, created_at")
    .order("created_at" as never, { ascending: false } as never)
    .limit(500)) as unknown as { data: Row[] | null };

  const all = data ?? [];
  const counts = new Map<string, number>();
  for (const r of all) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);

  const active = statusFilter && PIPELINE.some((p) => p.key === statusFilter)
    ? statusFilter
    : null;
  const rows = active ? all.filter((r) => r.status === active) : all;

  return (
    <PageShell
      title="Applicants"
      description="Job applications submitted through your hiring form."
    >
      {/* Pipeline filter */}
      <div className="mb-5 flex flex-wrap gap-2">
        <Link
          href="/app/applicants"
          className={cn(
            "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
            !active
              ? "bg-foreground text-background"
              : "bg-muted text-muted-foreground hover:text-foreground",
          )}
        >
          All ({all.length})
        </Link>
        {PIPELINE.map((p) => (
          <Link
            key={p.key}
            href={`/app/applicants?status=${p.key}`}
            className={cn(
              "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
              active === p.key
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {p.label} ({counts.get(p.key) ?? 0})
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center">
          <Inbox className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm font-medium">No applicants here yet</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Connect your hiring form to the intake webhook in Settings →
            Intake forms, and submissions will land here automatically.
          </p>
          <Link
            href="/app/settings/intake-forms"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-2")}
          >
            Get the form URL
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted/50"
            >
              <Link
                href={`/app/applicants/${r.id}`}
                className="min-w-0 flex-1"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-base font-semibold">
                    {r.name ?? "Unnamed applicant"}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {r.position && (
                    <span className="inline-flex items-center gap-1">
                      <Briefcase className="h-3 w-3" /> {r.position}
                    </span>
                  )}
                  {r.email && (
                    <span className="inline-flex items-center gap-1">
                      <Mail className="h-3 w-3" /> {r.email}
                    </span>
                  )}
                  {r.phone && (
                    <span className="inline-flex items-center gap-1">
                      <Phone className="h-3 w-3" /> {r.phone}
                    </span>
                  )}
                </div>
              </Link>
              <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                {formatDateTime(r.created_at, tz)}
              </span>
              <ApplicantQuickStatus id={r.id} status={r.status} />
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
