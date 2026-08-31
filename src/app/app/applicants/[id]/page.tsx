import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Mail, Phone, ExternalLink, Trash2 } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { cn } from "@/lib/utils";
import { getOrgTimezone } from "@/lib/org-timezone";
import { formatDateTime } from "@/lib/format";
import { ApplicantControls } from "./applicant-controls";
import { HireDialog } from "./hire-dialog";
import { deleteApplicantAction } from "../actions";
import { STATUS_TONE } from "../page";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { memberDisplayName } from "@/lib/member-display";
import {
  InterviewPanel,
  type InterviewRow,
  type QuestionnaireOption,
} from "./interview-panel";

export const metadata = { title: "Applicant" };

type Applicant = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  position: string | null;
  experience: string | null;
  availability: string | null;
  message: string | null;
  resume_url: string | null;
  raw: Record<string, unknown> | null;
  status: string;
  notes: string | null;
  created_at: string;
};

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 whitespace-pre-wrap text-sm">{value}</dd>
    </div>
  );
}

export default async function ApplicantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const membership = await requireMembership(["owner", "admin"]);
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const tz = await getOrgTimezone(membership.organization_id);

  const { data: a } = (await supabase
    .from("job_applicants" as never)
    .select(
      "id, name, email, phone, position, experience, availability, message, resume_url, raw, status, notes, created_at",
    )
    .eq("id" as never, id as never)
    .maybeSingle()) as unknown as { data: Applicant | null };

  if (!a) notFound();

  // Interviews on file + startable questionnaires. Admin client (these
  // tables postdate the generated types), explicitly org-scoped.
  const admin = createSupabaseAdminClient();
  const [{ data: interviewRows }, { data: questionnaireRows }] =
    await Promise.all([
      admin
        .from("applicant_interviews" as never)
        .select(
          "id, title, questions, answers, notes, created_at, conductor:memberships ( display_name, profile:profiles ( full_name ) )",
        )
        .eq("applicant_id" as never, id as never)
        .eq(
          "organization_id" as never,
          membership.organization_id as never,
        )
        .order("created_at" as never, {
          ascending: false,
        } as never) as unknown as Promise<{
        data: Array<{
          id: string;
          title: string;
          questions: unknown;
          answers: unknown;
          notes: string | null;
          created_at: string;
          conductor: {
            display_name: string | null;
            profile: { full_name: string | null } | null;
          } | null;
        }> | null;
      }>,
      admin
        .from("hiring_docs" as never)
        .select("id, title")
        .eq("organization_id" as never, membership.organization_id as never)
        .eq("kind" as never, "questionnaire" as never)
        .eq("is_active" as never, true as never)
        .order("title" as never) as unknown as Promise<{
        data: Array<{ id: string; title: string }> | null;
      }>,
    ]);

  const interviews: InterviewRow[] = (interviewRows ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    questions: Array.isArray(r.questions) ? r.questions.map(String) : [],
    answers: Array.isArray(r.answers) ? r.answers.map(String) : [],
    notes: r.notes,
    created_at: r.created_at,
    conducted_by_name: r.conductor ? memberDisplayName(r.conductor) : null,
  }));
  const questionnaires: QuestionnaireOption[] = questionnaireRows ?? [];

  // Extra fields the form sent that we didn't map to a column.
  const mappedKeys = new Set([
    "name",
    "full_name",
    "fullname",
    "applicant_name",
    "email",
    "email_address",
    "phone",
    "phone_number",
    "tel",
    "mobile",
    "position",
    "role",
    "experience",
    "availability",
    "message",
    "cover_letter",
    "resume_url",
    "resume",
    "cv",
  ]);
  const extras = Object.entries(a.raw ?? {}).filter(
    ([k, v]) => !mappedKeys.has(k.toLowerCase()) && v != null && String(v).length > 0,
  );

  return (
    <PageShell title={a.name ?? "Applicant"} description="Job applicant detail">
      <Link
        href="/app/applicants"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> All applicants
      </Link>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-bold">
                  {a.name ?? "Unnamed applicant"}
                </h1>
                {a.position && (
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Applying for: {a.position}
                  </p>
                )}
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold capitalize",
                  STATUS_TONE[a.status] ?? STATUS_TONE.new,
                )}
              >
                {a.status}
              </span>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              {a.email && (
                <a
                  href={`mailto:${a.email}`}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/20"
                >
                  <Mail className="h-4 w-4" /> {a.email}
                </a>
              )}
              {a.phone && (
                <a
                  href={`tel:${a.phone}`}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/20"
                >
                  <Phone className="h-4 w-4" /> {a.phone}
                </a>
              )}
              {a.resume_url && (
                <a
                  href={a.resume_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/20"
                >
                  <ExternalLink className="h-4 w-4" /> Resume / link
                </a>
              )}
            </div>

            <dl className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="Experience" value={a.experience} />
              <Field label="Availability" value={a.availability} />
            </dl>
            <div className="mt-4">
              <Field label="Message" value={a.message} />
            </div>

            <p className="mt-5 text-xs text-muted-foreground">
              Received {formatDateTime(a.created_at, tz)}
            </p>
          </div>

          {/* Interviews — answers recorded against the questionnaire as it
              was asked, living on the applicant instead of in a notebook. */}
          <InterviewPanel
            applicantId={a.id}
            interviews={interviews}
            questionnaires={questionnaires}
          />

          {extras.length > 0 && (
            <details className="rounded-xl border border-border bg-card p-5">
              <summary className="cursor-pointer text-sm font-semibold">
                Other form fields ({extras.length})
              </summary>
              <dl className="mt-3 space-y-2">
                {extras.map(([k, v]) => (
                  <div key={k} className="flex gap-3 text-sm">
                    <dt className="w-40 shrink-0 truncate text-muted-foreground">
                      {k}
                    </dt>
                    <dd className="min-w-0 break-words">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </div>

        <div className="space-y-5">
          {/* The yes, as one button — invite prefilled from the application,
              wage + engagement chosen here, training auto-assigned at join. */}
          {a.status !== "hired" && a.status !== "rejected" && (
            <HireDialog applicantId={a.id} name={a.name} email={a.email} />
          )}
          <div className="rounded-xl border border-border bg-card p-5">
            <ApplicantControls id={a.id} status={a.status} notes={a.notes} />
          </div>

          <form action={deleteApplicantAction}>
            <input type="hidden" name="id" value={a.id} />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete applicant
            </button>
          </form>
        </div>
      </div>
    </PageShell>
  );
}
