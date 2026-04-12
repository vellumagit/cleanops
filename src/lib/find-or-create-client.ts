/**
 * Shared helper for API v1 routes: find an existing client by email or name,
 * or create a new one. Returns the client UUID.
 *
 * Match priority:
 *   1. Exact email match (case-insensitive)
 *   2. Exact name match (case-insensitive)
 *   3. Create new client
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dispatchWebhookEvent } from "@/lib/webhooks";

type ClientInput = {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
};

export async function findOrCreateClient(
  admin: SupabaseClient,
  organizationId: string,
  input: ClientInput,
): Promise<string | null> {
  // 1. Try email match
  if (input.email) {
    const { data: byEmail } = await admin
      .from("clients")
      .select("id")
      .eq("organization_id", organizationId)
      .ilike("email", input.email)
      .maybeSingle();

    if (byEmail) return byEmail.id;
  }

  // 2. Try name match
  const { data: byName } = await admin
    .from("clients")
    .select("id")
    .eq("organization_id", organizationId)
    .ilike("name", input.name)
    .maybeSingle();

  if (byName) return byName.id;

  // 3. Create new client
  const { data: newClient, error } = await admin
    .from("clients" as never)
    .insert({
      organization_id: organizationId,
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      address: input.address ?? null,
      preferred_contact: input.email ? "email" : "phone",
    } as never)
    .select("id")
    .single();

  if (error || !newClient) {
    console.error("[find-or-create-client] insert failed:", error?.message);
    return null;
  }

  const id = (newClient as unknown as { id: string }).id;

  dispatchWebhookEvent(organizationId, "client.created", {
    id,
    name: input.name,
    email: input.email ?? null,
  }).catch(() => {});

  return id;
}
