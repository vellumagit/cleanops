import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Gift,
  Pencil,
  Mail,
  Phone,
  Banknote,
  CalendarDays,
  HeartPulse,
  StickyNote,
} from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageShell } from "@/components/page-shell";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { isSubcontractor } from "@/lib/engagement";
import { buttonVariants } from "@/components/ui/button";
import { memberDisplayName } from "@/lib/member-display";
import { formatCurrencyCents, formatDate, humanizeEnum } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DocumentsPanel, type EmployeeDocument } from "./documents-panel";
import { getOrgTimezone } from "@/lib/org-timezone";

export const metadata = { title: "Employee file" };

const BUCKET = "employee-documents";

function roleTone(r: string): StatusTone {
  if (r === "owner" || r === "admin") return "blue";
  if (r === "manager") return "amber";
  return "neutral";
}
function statusTone(s: string): StatusTone {
  if (s === "active") return "green";
  if (s === "invited") return "amber";
  return "red";
}
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export default async function EmployeeFilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await requireMembership(["owner", "admin"]);
  const tz = await getOrgTimezone(viewer.organization_id);
  const { id } = await params;
  const admin = createSupabaseAdminClient();

  const { data: member } = (await admin
    .from("memberships")
    .select(
      "id, organization_id, profile_id, role, engagement, status, pay_rate_cents, display_name, contact_email, contact_phone, created_at, deactivated_at, profile:profiles(full_name, phone)",
    )
    .eq("id", id)
    .eq("organization_id", viewer.organization_id)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      profile_id: string | null;
      role: string;
      engagement: string | null;
      status: string;
      pay_rate_cents: number | null;
      display_name: string | null;
      contact_email: string | null;
      contact_phone: string | null;
      created_at: string;
      deactivated_at: string | null;
      profile: { full_name: string | null; phone: string | null } | null;
    } | null;
  };

  if (!member) notFound();

  // Admin-only fields (accommodations / health + general notes) for the file.
  const { data: adminData } = (await admin
    .from("membership_admin_data" as never)
    .select("accommodations, notes, exit_reason")
    .eq("membership_id" as never, id as never)
    .maybeSingle()) as unknown as {
    data: {
      accommodations: string | null;
      notes: string | null;
      exit_reason: string | null;
    } | null;
  };

  const name = memberDisplayName(member);
  const email = member.contact_email ?? null;
  const phone = member.profile?.phone ?? member.contact_phone ?? null;
  const isShadow = !member.profile_id;
  const isDisabled = member.status === "disabled";

  // Lifecycle strip data. The applicant record is matched by email — there's
  // no FK between job_applicants and memberships (they're deliberately two
  // rows), so email is the honest join. ilike gives case-insensitive
  // equality, but only after escaping LIKE wildcards: underscores are common
  // in real emails and an unescaped `_` matches any character, pinning the
  // wrong applicant's dates to this person's strip.
  const emailPattern = email?.replace(/[\\%_]/g, (m) => `\\${m}`) ?? null;
  const applicantPromise = emailPattern
    ? (admin
        .from("job_applicants" as never)
        .select("created_at, reviewed_at, status")
        .eq("organization_id" as never, viewer.organization_id as never)
        .ilike("email" as never, emailPattern as never)
        .order("created_at" as never, { ascending: true } as never)
        .limit(1)
        .maybeSingle() as unknown as Promise<{
        data: {
          created_at: string;
          reviewed_at: string | null;
          status: string;
        } | null;
      }>)
    : Promise.resolve({ data: null });

  // The settlement question only exists once they're off the roster — for
  // active people "unpaid hours" is just the normal course of a pay period.
  const settlementPromise = isDisabled
    ? import("@/lib/final-settlement").then(({ getFinalSettlement }) =>
        getFinalSettlement(
          admin,
          viewer.organization_id,
          member.id,
          member.pay_rate_cents,
        ),
      )
    : Promise.resolve(null);

  const [{ data: applicant }, settlement] = await Promise.all([
    applicantPromise,
    settlementPromise,
  ]);

  const lifecycle: Array<{ label: string; date: string | null }> = [];
  if (applicant) lifecycle.push({ label: "Applied", date: applicant.created_at });
  if (applicant?.status === "hired")
    lifecycle.push({ label: "Hired", date: applicant.reviewed_at });
  lifecycle.push({ label: "Joined", date: member.created_at });
  if (isDisabled)
    lifecycle.push({ label: "Deactivated", date: member.deactivated_at });

  // Documents for this person's file.
  const { data: rawDocs } = (await admin
    .from("membership_documents" as never)
    .select("id, category, label, file_name, size_bytes, file_path, created_at")
    .eq("membership_id" as never, id)
    .order(
      "created_at" as never,
      { ascending: false } as never,
    )) as unknown as {
    data: Array<{
      id: string;
      category: string;
      label: string;
      file_name: string;
      size_bytes: number | null;
      file_path: string;
      created_at: string;
    }> | null;
  };

  // Sign each file so the panel can offer a (short-lived) download link.
  const documents: EmployeeDocument[] = await Promise.all(
    (rawDocs ?? []).map(async (d) => {
      const { data } = await admin.storage
        .from(BUCKET)
        .createSignedUrl(d.file_path, 3600);
      return {
        id: d.id,
        category: d.category,
        label: d.label,
        file_name: d.file_name,
        size_bytes: d.size_bytes,
        created_at: d.created_at,
        url: data?.signedUrl ?? null,
      };
    }),
  );

  // Training, from this person's side. Every other training surface is
  // module-centric — answering "is this cleaner trained?" used to mean
  // opening every module and scanning for their name.
  const [{ data: orgModules }, { data: trainingRows }] = await Promise.all([
    (admin
      .from("training_modules")
      .select(
        "id, title, status, audience_roles, steps:training_steps ( id )" as never,
      )
      .eq("organization_id", viewer.organization_id)) as unknown as Promise<{
      data: Array<{
        id: string;
        title: string;
        status: string | null;
        audience_roles: string[] | null;
        steps: Array<{ id: string }> | null;
      }> | null;
    }>,
    (admin
      .from("training_assignments")
      .select(
        "module_id, completed_at, completed_step_ids, certification_expires_at",
      )
      .eq("employee_id", id)
      .eq(
        "organization_id",
        viewer.organization_id,
      )) as unknown as Promise<{
      data: Array<{
        module_id: string;
        completed_at: string | null;
        completed_step_ids: string[] | null;
        certification_expires_at: string | null;
      }> | null;
    }>,
  ]);
  const assignmentByModule = new Map(
    (trainingRows ?? []).map((a) => [a.module_id, a]),
  );
  // Published modules FOR THIS PERSON'S LEVEL show (assigned or not);
  // anything they carry an assignment for shows regardless — history and
  // deliberate one-offs never vanish from the file.
  const training = (orgModules ?? [])
    .filter(
      (m) =>
        assignmentByModule.has(m.id) ||
        (m.status === "published" &&
          (m.audience_roles ?? ["employee"]).includes(member.role)),
    )
    .map((m) => {
      const a = assignmentByModule.get(m.id);
      return {
        id: m.id,
        title: m.title,
        stepCount: m.steps?.length ?? 0,
        assigned: !!a,
        completedAt: a?.completed_at ?? null,
        progressSteps: a?.completed_step_ids?.length ?? 0,
        certExpiresAt: a?.certification_expires_at ?? null,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));

  return (
    <PageShell
      title="Employee file"
      actions={
        <div className="flex items-center gap-2">
          <Link
            href="/app/employees"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          >
            <ArrowLeft className="h-4 w-4" />
            Team
          </Link>
          {/* Deep link — the bonuses page opens its dialog with this
              person locked in, instead of re-finding them in a dropdown. */}
          <Link
            href={`/app/bonuses?employee=${member.id}`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            <Gift className="h-4 w-4" />
            Add bonus
          </Link>
          <Link
            href={`/app/employees/${member.id}/edit`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            <Pencil className="h-4 w-4" />
            Edit details
          </Link>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Profile header */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-muted text-lg font-semibold text-muted-foreground">
              {initials(name) || "?"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">{name}</h2>
                <StatusBadge tone={roleTone(member.role)}>
                  {humanizeEnum(member.role)}
                </StatusBadge>
                {isSubcontractor(member.engagement) && (
                  <StatusBadge tone="neutral">Subcontractor</StatusBadge>
                )}
                <StatusBadge tone={statusTone(member.status)}>
                  {humanizeEnum(member.status)}
                </StatusBadge>
                {isShadow && (
                  <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                    Manually added
                  </span>
                )}
              </div>
              <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Mail className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate text-foreground">
                    {email ?? "—"}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="h-3.5 w-3.5 shrink-0" />
                  <span className="text-foreground">{phone ?? "—"}</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Banknote className="h-3.5 w-3.5 shrink-0" />
                  <span className="text-foreground">
                    {member.pay_rate_cents == null
                      ? "—"
                      : `${formatCurrencyCents(member.pay_rate_cents)}/hr`}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                  <span className="text-foreground">
                    Joined {formatDate(member.created_at, tz)}
                  </span>
                </div>
              </dl>
            </div>
          </div>

          {/* Lifecycle strip — the whole story in one line. Stages render
              only when their moment is known: Applied/Hired come from the
              applicant record matched by email, Deactivated from the exit
              stamp (older offboards predate it and show without a date). */}
          <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-border pt-3 text-[11px] text-muted-foreground">
            {lifecycle.map((stage, i) => (
              <span key={stage.label} className="flex items-center gap-1.5">
                {i > 0 && <span aria-hidden>›</span>}
                <span
                  className={cn(
                    "font-medium",
                    stage.label === "Deactivated"
                      ? "text-red-600 dark:text-red-400"
                      : "text-foreground",
                  )}
                >
                  {stage.label}
                </span>
                {stage.date && <span>{formatDate(stage.date, tz)}</span>}
              </span>
            ))}
          </div>

          {isDisabled && adminData?.exit_reason && (
            <p className="mt-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                Reason for leaving:
              </span>{" "}
              {adminData.exit_reason}
            </p>
          )}
        </div>

        {/* Final settlement — only for deactivated members. For active
            people "unpaid hours" is just an open pay period; for someone
            off the roster it's a debt with no automatic collector (bonuses
            and PTO especially — no future run touches them). */}
        {settlement && (
          <div
            className={cn(
              "rounded-xl border p-4",
              settlement.totalCents > 0 ||
                settlement.ptoCount > 0 ||
                settlement.flaggedCount > 0
                ? "border-amber-300/60 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20"
                : "border-border bg-card",
            )}
          >
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-semibold">Final settlement</h3>
              <span className="text-sm font-bold tabular-nums">
                {formatCurrencyCents(settlement.totalCents)}
              </span>
            </div>
            {settlement.totalCents === 0 &&
            settlement.ptoCount === 0 &&
            settlement.flaggedCount === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Nothing owed — hours, bonuses, and tips are all settled.
              </p>
            ) : (
              <ul className="mt-2 space-y-1 text-xs">
                {settlement.unpaidHoursCents > 0 && (
                  <li className="flex justify-between gap-3">
                    <span>
                      Unpaid hours ({Math.floor(settlement.unpaidMinutes / 60)}h{" "}
                      {settlement.unpaidMinutes % 60}m across{" "}
                      {settlement.unpaidEntryCount} shift
                      {settlement.unpaidEntryCount === 1 ? "" : "s"}) — the
                      next pay run picks these up
                    </span>
                    <span className="shrink-0 tabular-nums font-medium">
                      {formatCurrencyCents(settlement.unpaidHoursCents)}
                    </span>
                  </li>
                )}
                {settlement.bonusCents > 0 && (
                  <li className="flex justify-between gap-3">
                    <span>
                      Pending bonus{settlement.bonusCount === 1 ? "" : "es"} —{" "}
                      <Link
                        href="/app/bonuses"
                        className="underline underline-offset-2"
                      >
                        pay or delete on Bonuses
                      </Link>
                      ; no run will pick {settlement.bonusCount === 1 ? "it" : "them"} up
                    </span>
                    <span className="shrink-0 tabular-nums font-medium">
                      {formatCurrencyCents(settlement.bonusCents)}
                    </span>
                  </li>
                )}
                {settlement.tipsCents > 0 && (
                  <li className="flex justify-between gap-3">
                    <span>
                      Tips owed —{" "}
                      <Link
                        href="/app/payroll"
                        className="underline underline-offset-2"
                      >
                        settle on Payroll
                      </Link>{" "}
                      (mark paid, or keep in business)
                    </span>
                    <span className="shrink-0 tabular-nums font-medium">
                      {formatCurrencyCents(settlement.tipsCents)}
                    </span>
                  </li>
                )}
                {settlement.ptoCount > 0 && (
                  <li className="flex justify-between gap-3">
                    <span>
                      Approved future time off ({settlement.ptoHours}h) —
                      pay out or remove; not counted in the total
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      your call
                    </span>
                  </li>
                )}
                {settlement.flaggedCount > 0 && (
                  <li className="text-amber-800 dark:text-amber-300">
                    {settlement.flaggedCount} shift
                    {settlement.flaggedCount === 1 ? "" : "s"} still flagged
                    for review on Timesheets — blocked from every pay run
                    until confirmed, then added here.
                  </li>
                )}
              </ul>
            )}
          </div>
        )}

        {/* Accommodations & health — surfaced prominently so anyone opening
            the file sees safety-relevant info first. */}
        {adminData?.accommodations && (
          <div className="rounded-xl border border-amber-300/60 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
            <div className="flex items-start gap-2.5">
              <HeartPulse className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                  Accommodations &amp; health
                </h3>
                <p className="mt-1 whitespace-pre-wrap text-sm text-amber-900/90 dark:text-amber-200/90">
                  {adminData.accommodations}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* General internal notes */}
        {adminData?.notes && (
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start gap-2.5">
              <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Internal notes
                </h3>
                <p className="mt-1 whitespace-pre-wrap text-sm">
                  {adminData.notes}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Training */}
        <div className="rounded-xl border border-border bg-card">
          <div className="flex items-baseline justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Training</h2>
            <span className="text-xs text-muted-foreground">
              {training.filter((t) => t.completedAt).length} of{" "}
              {training.filter((t) => t.assigned).length} assigned complete
            </span>
          </div>
          {training.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">
              No training modules yet.
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {training.map((t) => {
                const expired =
                  t.certExpiresAt && new Date(t.certExpiresAt) < new Date();
                return (
                  <li key={t.id}>
                    <Link
                      href={`/app/training/${t.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50"
                    >
                      <span className="min-w-0 truncate text-sm font-medium">
                        {t.title}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {t.certExpiresAt && (
                          <span
                            className={cn(
                              "text-[11px]",
                              expired
                                ? "font-medium text-red-600 dark:text-red-400"
                                : "text-muted-foreground",
                            )}
                          >
                            {expired ? "Expired" : "Expires"}{" "}
                            {formatDate(t.certExpiresAt, tz)}
                          </span>
                        )}
                        {t.completedAt ? (
                          <StatusBadge tone={expired ? "red" : "green"}>
                            Completed {formatDate(t.completedAt, tz)}
                          </StatusBadge>
                        ) : !t.assigned ? (
                          <StatusBadge tone="neutral">Not assigned</StatusBadge>
                        ) : t.progressSteps > 0 ? (
                          <StatusBadge tone="amber">
                            In progress · {t.progressSteps}/{t.stepCount} steps
                          </StatusBadge>
                        ) : (
                          <StatusBadge tone="amber">Not started</StatusBadge>
                        )}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Documents */}
        <div>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Documents</h2>
            <span className="text-xs text-muted-foreground">
              {documents.length} file{documents.length === 1 ? "" : "s"} ·
              private to owners &amp; admins
            </span>
          </div>
          <DocumentsPanel membershipId={member.id} documents={documents} />
        </div>
      </div>
    </PageShell>
  );
}
