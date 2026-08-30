import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOrgCurrency } from "@/lib/org-currency";
import { PageShell } from "@/components/page-shell";
import { EstimateForm } from "../estimate-form";

export const metadata = { title: "New estimate" };

export default async function NewEstimatePage({
  searchParams,
}: {
  searchParams: Promise<{ client_id?: string }>;
}) {
  const membership = await requireMembership(["owner", "admin", "manager"]);
  const supabase = await createSupabaseServerClient();
  const currency = await getOrgCurrency(membership.organization_id);
  const { client_id } = await searchParams;

  const { data: clients } = await supabase
    .from("clients")
    .select("id, name")
    // Explicit org scope — a two-org admin reads both orgs via RLS alone.
    .eq("organization_id", membership.organization_id)
    .order("name");

  // Arriving from a client's page (or a lead row's Quote button): preselect
  // them, and for a lead seed the description from what they said they
  // wanted — the lead_note is literally the request in their words.
  const prefillClient =
    client_id && (clients ?? []).some((c) => c.id === client_id)
      ? client_id
      : undefined;
  let prefillDescription: string | null = null;
  if (prefillClient) {
    const { data: c } = (await supabase
      .from("clients")
      .select("lifecycle, lead_note" as never)
      .eq("id", prefillClient)
      .eq("organization_id", membership.organization_id)
      .maybeSingle()) as unknown as {
      data: { lifecycle: string | null; lead_note: string | null } | null;
    };
    if (c?.lifecycle === "lead" && c.lead_note?.trim()) {
      prefillDescription = c.lead_note.trim();
    }
  }

  return (
    <PageShell title="New estimate" description="Quote work for a client.">
      <div className="max-w-2xl rounded-lg border border-border bg-card p-6">
        <EstimateForm
          mode="create"
          currency={currency}
          clients={(clients ?? []).map((c) => ({ id: c.id, label: c.name }))}
          defaults={{
            ...(prefillClient ? { client_id: prefillClient } : {}),
            ...(prefillDescription
              ? { service_description: prefillDescription }
              : {}),
          }}
        />
      </div>
    </PageShell>
  );
}
