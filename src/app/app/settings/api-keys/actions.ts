"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { logAuditEvent } from "@/lib/audit";
import { generateApiKey } from "@/lib/api-keys";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Create a new API key for the current organization.
 * Returns the raw key exactly once — it cannot be retrieved again.
 */
export async function createApiKeyAction(
  label: string,
): Promise<{ rawKey: string } | { error: string }> {
  if (!label || label.trim().length === 0) {
    return { error: "Label is required" };
  }
  if (label.trim().length > 100) {
    return { error: "Label must be 100 characters or less" };
  }

  const { membership } = await getActionContext();

  // Only owner/admin can manage API keys
  if (!["owner", "admin"].includes(membership.role)) {
    return { error: "Insufficient permissions" };
  }

  const { rawKey, keyHash, keyPrefix } = generateApiKey();

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("api_keys" as never).insert({
    organization_id: membership.organization_id,
    key_hash: keyHash,
    key_prefix: keyPrefix,
    label: label.trim(),
    created_by: membership.id,
  } as never);

  if (error) {
    return { error: error.message };
  }

  await logAuditEvent({
    membership,
    action: "create",
    entity: "api_key" as never,
    after: { label: label.trim(), key_prefix: keyPrefix },
  });

  revalidatePath("/app/settings/api-keys");
  return { rawKey };
}

/**
 * Revoke an API key — sets revoked_at so it stops authenticating.
 */
export async function revokeApiKeyAction(keyId: string): Promise<{ error?: string }> {
  if (!keyId) return { error: "Key ID is required" };

  const { membership } = await getActionContext();

  if (!["owner", "admin"].includes(membership.role)) {
    return { error: "Insufficient permissions" };
  }

  const admin = createSupabaseAdminClient();

  // Verify the key belongs to this org
  const { data: existing } = await admin
    .from("api_keys" as never)
    .select("id, label, key_prefix, organization_id, revoked_at")
    .eq("id", keyId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle();

  const row = existing as unknown as {
    id: string;
    label: string;
    key_prefix: string;
    organization_id: string;
    revoked_at: string | null;
  } | null;

  if (!row) return { error: "API key not found" };
  if (row.revoked_at) return { error: "Key is already revoked" };

  const { error } = await admin
    .from("api_keys" as never)
    .update({ revoked_at: new Date().toISOString() } as never)
    .eq("id" as never, keyId as never);

  if (error) return { error: error.message };

  await logAuditEvent({
    membership,
    action: "deactivate" as never,
    entity: "api_key" as never,
    entity_id: keyId,
    before: { label: row.label, key_prefix: row.key_prefix },
    after: { revoked: true },
  });

  revalidatePath("/app/settings/api-keys");
  return {};
}
