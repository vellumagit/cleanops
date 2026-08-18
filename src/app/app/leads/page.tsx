import Link from "next/link";
import { requireMembership, requireCapability } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { formatDate } from "@/lib/format";
import { getOrgTimezone } from "@/lib/org-timezone";
import {
  LEAD_STAGES,
  parseLeadStage,
  parseLeadSource,
  sourceLabel,
  type LeadStage,
} from "@/lib/lead-pipeline";
import { QuickAddLead } from "./quick-add";
import { LeadRowActions } from "./lead-row-actions";

export const metadata = { title: "Leads" };

/**
 * Always fresh. Someone adds a lead while holding a phone and immediately looks
 * for it in the list — a cached render here reads as "it didn't save".
 */
export const dynamic = "force-dynamic";

type LeadRecord = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  lead_stage: string | null;
  lead_source: string | null;
  lead_note: string | null;
  created_at: string;
};

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ lost?: string }>;
}) {
  const membership = await requireMembership();
  // Leads ARE client records, so they answer to the clients capability rather
  // than inventing a sixth switch for the same trust decision.
  requireCapability(membership, "clients");
  const supabase = await createSupabaseServerClient();
  const tz = await getOrgTimezone(membership.organization_id);
  const { lost } = await searchParams;
  const showLost = lost === "1";

  const { data, error } = (await supabase
    .from("clients")
    .select(
      "id, name, phone, email, lead_stage, lead_source, lead_note, created_at",
    )
    .eq("lifecycle" as never, (showLost ? "lost" : "lead") as never)
    .is("archived_at" as never, null as never)
    .order("created_at", { ascending: false })
    .limit(300)) as unknown as {
    data: LeadRecord[] | null;
    error: { message: string } | null;
  };

  if (error) throw error;
  const leads = data ?? [];

  // Grouped by stage rather than one flat list: "who haven't I called back" is
  // the question this page exists to answer, and a date-sorted list buries it.
  const byStage = new Map<LeadStage, LeadRecord[]>(
    LEAD_STAGES.map((s) => [s.key, [] as LeadRecord[]]),
  );
  for (const l of leads) {
    byStage.get(parseLeadStage(l.lead_stage))?.push(l);
  }

  return (
    <PageShell
      title={showLost ? "Leads — lost" : "Leads"}
      description={
        showLost
          ? "Leads that went elsewhere. Kept, in case they come back."
          : "People who've asked but haven't booked yet. Booking one turns them into a client automatically."
      }
      actions={
        <Link
          href={showLost ? "/app/leads" : "/app/leads?lost=1"}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {showLost ? "← Open leads" : "Lost leads"}
        </Link>
      }
    >
      <div className="space-y-5">
        {!showLost && <QuickAddLead />}

        {leads.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/20 px-6 py-14 text-center">
            <p className="text-sm font-medium">
              {showLost ? "No lost leads" : "No open leads"}
            </p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
              {showLost
                ? "Nothing here yet."
                : "Inquiries from your website form land here on their own. Anyone who phones or emails needs adding above — it takes a name and nothing else."}
            </p>
          </div>
        ) : showLost ? (
          <LeadList rows={leads} tz={tz} lost />
        ) : (
          LEAD_STAGES.map((stage) => {
            const rows = byStage.get(stage.key) ?? [];
            if (rows.length === 0) return null;
            return (
              <section key={stage.key}>
                <div className="mb-2 flex items-baseline gap-2">
                  <h2 className="text-sm font-semibold">{stage.label}</h2>
                  <span className="text-xs text-muted-foreground">
                    {rows.length} · {stage.hint}
                  </span>
                </div>
                <LeadList rows={rows} tz={tz} />
              </section>
            );
          })
        )}
      </div>
    </PageShell>
  );
}

function LeadList({
  rows,
  tz,
  lost = false,
}: {
  rows: LeadRecord[];
  tz: string;
  lost?: boolean;
}) {
  return (
    <ul className="space-y-2">
      {rows.map((l) => (
        <li
          key={l.id}
          className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-card p-3"
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-2">
              {/* Links to the CLIENT record — a lead is one, which is exactly
                  why estimates and notes work on them already. */}
              <Link
                href={`/app/clients/${l.id}`}
                className="text-sm font-medium hover:underline underline-offset-2"
              >
                {l.name}
              </Link>
              <span className="text-[11px] text-muted-foreground">
                {sourceLabel(parseLeadSource(l.lead_source))} ·{" "}
                {formatDate(l.created_at, tz)}
              </span>
            </div>
            {l.lead_note && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {l.lead_note}
              </p>
            )}
            <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
              {l.phone && <a href={`tel:${l.phone}`}>{l.phone}</a>}
              {l.email && <a href={`mailto:${l.email}`}>{l.email}</a>}
              {!l.phone && !l.email && (
                <span className="italic">no contact details</span>
              )}
            </div>
          </div>

          <LeadRowActions
            id={l.id}
            stage={parseLeadStage(l.lead_stage)}
            lost={lost}
          />
        </li>
      ))}
    </ul>
  );
}
