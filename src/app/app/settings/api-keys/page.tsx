import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageShell } from "@/components/page-shell";
import { ApiKeysClient } from "./api-keys-client";

export const metadata = { title: "API Keys" };

export default async function ApiKeysPage() {
  const membership = await requireMembership(["owner", "admin"]);

  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("api_keys" as never)
    .select("id, key_prefix, label, created_at, last_used_at, revoked_at")
    .eq("organization_id", membership.organization_id)
    .order("created_at", { ascending: false });

  const keys = (data ?? []) as unknown as Array<{
    id: string;
    key_prefix: string;
    label: string;
    created_at: string;
    last_used_at: string | null;
    revoked_at: string | null;
  }>;

  return (
    <PageShell
      title="API Keys"
      description="Generate API keys to connect Make.com, Zapier, n8n, or any automation tool to your Sollos 3 data."
    >
      <ApiKeysClient keys={keys} />
    </PageShell>
  );
}
