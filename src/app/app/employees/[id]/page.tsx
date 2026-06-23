import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Pencil, Mail, Phone, Banknote, CalendarDays } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageShell } from "@/components/page-shell";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { memberDisplayName } from "@/lib/member-display";
import { formatCurrencyCents, formatDate, humanizeEnum } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DocumentsPanel, type EmployeeDocument } from "./documents-panel";

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
  const { id } = await params;
  const admin = createSupabaseAdminClient();

  const { data: member } = (await admin
    .from("memberships")
    .select(
      "id, organization_id, profile_id, role, status, pay_rate_cents, display_name, contact_email, contact_phone, created_at, profile:profiles(full_name, phone)",
    )
    .eq("id", id)
    .eq("organization_id", viewer.organization_id)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      profile_id: string | null;
      role: string;
      status: string;
      pay_rate_cents: number | null;
      display_name: string | null;
      contact_email: string | null;
      contact_phone: string | null;
      created_at: string;
      profile: { full_name: string | null; phone: string | null } | null;
    } | null;
  };

  if (!member) notFound();

  const name = memberDisplayName(member);
  const email = member.contact_email ?? null;
  const phone = member.profile?.phone ?? member.contact_phone ?? null;
  const isShadow = !member.profile_id;

  // Documents for this person's file.
  const { data: rawDocs } = (await admin
    .from("membership_documents" as never)
    .select("id, category, label, file_name, size_bytes, file_path, created_at")
    .eq("membership_id" as never, id)
    .order("created_at" as never, { ascending: false } as never)) as unknown as {
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
                    Joined {formatDate(member.created_at)}
                  </span>
                </div>
              </dl>
            </div>
          </div>
        </div>

        {/* Documents */}
        <div>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Documents</h2>
            <span className="text-xs text-muted-foreground">
              {documents.length} file{documents.length === 1 ? "" : "s"} · private
              to owners &amp; admins
            </span>
          </div>
          <DocumentsPanel membershipId={member.id} documents={documents} />
        </div>
      </div>
    </PageShell>
  );
}
