import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOrgCurrency } from "@/lib/org-currency";
import { PageShell } from "@/components/page-shell";
import { centsToDollarString } from "@/lib/validators/common";
import { ContractForm } from "../../contract-form";
import { fetchContractFormOptions } from "../../options";
import { DeleteContractForm } from "./delete-form";
import { ContractDocuments } from "../../contract-documents";
import { SignaturePanel } from "./signature-panel";

export const metadata = { title: "Edit contract" };

export default async function EditContractPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const membership = await requireMembership(["owner", "admin", "manager"]);
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const currency = await getOrgCurrency(membership.organization_id);

  const { data: contract, error } = await supabase
    .from("contracts")
    .select(
      "id, client_id, estimate_id, service_type, start_date, end_date, agreed_price_cents, payment_terms, status",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!contract) notFound();

  const admin = createSupabaseAdminClient();

  // Pull sign columns separately — not yet in generated types.
  const { data: signInfo } = (await admin
    .from("contracts")
    .select("public_token, sign_status, signed_at, signer_name")
    .eq("id", id)
    .maybeSingle()) as unknown as {
    data: {
      public_token: string | null;
      sign_status: "unsent" | "sent" | "signed" | "declined" | null;
      signed_at: string | null;
      signer_name: string | null;
    } | null;
  };

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";

  const [{ clients, estimates }, { data: docsRaw }] = await Promise.all([
    fetchContractFormOptions(),
    admin
      .from("contract_documents" as never)
      .select("id, name, file_size, mime_type, created_at, storage_path")
      .eq("contract_id" as never, id as never)
      .eq("organization_id" as never, membership.organization_id as never)
      .order("created_at" as never, { ascending: false } as never) as unknown as Promise<{
      data: Array<{
        id: string;
        name: string;
        file_size: number | null;
        mime_type: string | null;
        created_at: string;
        storage_path: string;
      }> | null;
    }>,
  ]);

  // Generate signed URLs (1 hour) for each doc
  const docs = await Promise.all(
    (docsRaw ?? []).map(async (d) => {
      const { data: signedData } = await admin.storage
        .from("contract-docs")
        .createSignedUrl(d.storage_path, 3600);
      return {
        id: d.id,
        name: d.name,
        file_size: d.file_size,
        mime_type: d.mime_type,
        created_at: d.created_at,
        download_url: signedData?.signedUrl ?? "",
      };
    }),
  );

  return (
    <PageShell title="Edit contract">
      <div className="max-w-2xl space-y-6">
        <div className="rounded-lg border border-border bg-card p-6">
          <ContractForm
            mode="edit"
            id={contract.id}
            currency={currency}
            clients={clients}
            estimates={estimates}
            defaults={{
              client_id: contract.client_id,
              estimate_id: contract.estimate_id,
              service_type: contract.service_type,
              start_date: contract.start_date,
              end_date: contract.end_date,
              agreed_price_dollars: centsToDollarString(
                contract.agreed_price_cents,
              ),
              payment_terms: contract.payment_terms,
              status: contract.status,
            }}
          />
        </div>
        <div className="rounded-lg border border-border bg-card p-6">
          <SignaturePanel
            contractId={contract.id}
            initialToken={signInfo?.public_token ?? null}
            signStatus={signInfo?.sign_status ?? "unsent"}
            signedAt={signInfo?.signed_at ?? null}
            signerName={signInfo?.signer_name ?? null}
            siteUrl={siteUrl}
          />
        </div>

        <div className="rounded-lg border border-border bg-card p-6">
          <ContractDocuments
            contractId={contract.id}
            docs={docs}
            canEdit={membership.role !== "employee"}
          />
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6">
          <h2 className="text-sm font-semibold text-destructive">Danger zone</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Deleting will remove this contract permanently.
          </p>
          <div className="mt-4">
            <DeleteContractForm id={contract.id} />
          </div>
        </div>
      </div>
    </PageShell>
  );
}
