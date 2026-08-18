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
import { newLeadPatch } from "@/lib/lead-pipeline";

type ClientInput = {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
};

type Options = {
  /**
   * What a NEWLY created record should be.
   *
   * Defaults to "client", which is what all three callers did before leads
   * existed — the bookings and invoices routes are right to keep it, because
   * booking or invoicing someone means they are a customer by definition. Only
   * the estimates route (Svitlana's website inquiry form) passes "lead": asking
   * for a price is not the same as becoming a customer, and treating it that
   * way is what put 19 non-customers in her client list.
   */
  createAs?: "client" | "lead";
};

/**
 * Someone we'd written off has asked again.
 *
 * A matched record is NEVER demoted — an existing client who requests a quote
 * stays a client, which is the whole reason the match paths return early. But a
 * LOST lead filling in the form again is a live lead by any sane reading, and
 * leaving them filed as lost means the inquiry lands nowhere anyone looks.
 * Stage goes to "contacted" rather than "new": there is history here.
 */
async function maybeReopen(
  admin: SupabaseClient,
  row: { id: string; lifecycle: string | null },
  asLead: boolean,
): Promise<void> {
  if (!asLead || row.lifecycle !== "lost") return;
  await (admin
    .from("clients")
    .update({ lifecycle: "lead", lead_stage: "contacted" } as never)
    .eq("id", row.id) as unknown as Promise<unknown>);
}

export async function findOrCreateClient(
  admin: SupabaseClient,
  organizationId: string,
  input: ClientInput,
  options: Options = {},
): Promise<string | null> {
  const asLead = options.createAs === "lead";

  // 1. Try email match
  if (input.email) {
    const { data: byEmail } = (await admin
      .from("clients")
      .select("id, lifecycle")
      .eq("organization_id", organizationId)
      .ilike("email", input.email)
      .maybeSingle()) as unknown as {
      data: { id: string; lifecycle: string | null } | null;
    };

    if (byEmail) {
      await maybeReopen(admin, byEmail, asLead);
      return byEmail.id;
    }
  }

  // 2. Try name match
  const { data: byName } = (await admin
    .from("clients")
    .select("id, lifecycle")
    .eq("organization_id", organizationId)
    .ilike("name", input.name)
    .maybeSingle()) as unknown as {
    data: { id: string; lifecycle: string | null } | null;
  };

  if (byName) {
    await maybeReopen(admin, byName, asLead);
    return byName.id;
  }

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
      // Absent when createAs is "client", so the column keeps its 'client'
      // default and the two other callers behave exactly as before.
      ...(asLead ? newLeadPatch("web_form") : {}),
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
