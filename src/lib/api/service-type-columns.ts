/**
 * Helper for the public API (/api/v1/bookings/*) to materialize the
 * three correlated service columns from a consumer-supplied enum.
 *
 * The web form ships `service_type` + `service_type_id` +
 * `service_type_label` from a single dropdown selection. The API
 * accepts only the legacy enum string, so we look up the org's first
 * active `service_types` row matching that category to populate the
 * FK + display name.
 *
 * Fallback semantics: if the org has no active service in that
 * category (archived everything, or category drift), we return the
 * enum but null FK + null label. The booking row still inserts; the
 * display layer falls back to humanizing the enum.
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

const VALID_ENUM = new Set([
  "standard",
  "deep",
  "move_out",
  "recurring",
  "meeting",
  "consultation",
  "walkthrough",
  "other",
]);

export type ServiceTypeColumns = {
  service_type: string;
  service_type_id: string | null;
  service_type_label: string | null;
};

/**
 * Validate a consumer-supplied service_type string against the enum
 * + look up the org's matching catalog row.
 *
 * Returns `null` when the input is invalid — callers should respond
 * with a 400.
 */
export async function resolveServiceTypeColumns(
  // PostgREST client (admin or anon — caller's choice)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any, "public", any>,
  organizationId: string,
  serviceTypeEnum: string,
): Promise<ServiceTypeColumns | null> {
  if (!VALID_ENUM.has(serviceTypeEnum)) return null;

  // Look up the first active service in the org's catalog matching
  // this category. sort_order ASC picks the seeded default for
  // standard/deep/etc., or the first custom service for "other".
  const { data } = (await client
    .from("service_types" as never)
    .select("id, name")
    .eq("organization_id" as never, organizationId as never)
    .eq("category" as never, serviceTypeEnum as never)
    .eq("is_active" as never, true as never)
    .order("sort_order" as never, { ascending: true } as never)
    .limit(1)
    .maybeSingle()) as unknown as {
    data: { id: string; name: string } | null;
  };

  return {
    service_type: serviceTypeEnum,
    service_type_id: data?.id ?? null,
    service_type_label: data?.name ?? null,
  };
}

/** Cheap pre-check used by PATCH so it can 400 before doing any DB work. */
export function isValidServiceTypeEnum(value: unknown): value is string {
  return typeof value === "string" && VALID_ENUM.has(value);
}
