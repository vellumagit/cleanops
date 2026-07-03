import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Foreign-key fields a v1 API caller can supply, mapped to the table the id
 * must live in. Every one of these tables carries an `organization_id`.
 */
const REF_TABLES = {
  client_id: "clients",
  booking_id: "bookings",
  assigned_to: "memberships",
  package_id: "packages",
} as const;

export type OrgRefField = keyof typeof REF_TABLES;

/**
 * Verify that every supplied foreign id references a row owned by
 * `organizationId`. The v1 API mutates through the service-role client (RLS is
 * bypassed), so without this a caller could point client_id / booking_id /
 * assigned_to / package_id at ANOTHER tenant's row — corrupting cross-tenant
 * relational integrity and, via read-time FK embeds (e.g. client:clients(name,
 * email) on the GET routes), leaking that tenant's customer PII.
 *
 * Returns the name of the first offending field (missing, malformed, or owned
 * by a different org), or null when every provided ref is valid or absent.
 * Absent/blank values are skipped — pass the raw request fields directly.
 */
export async function findCrossOrgRef(
  admin: AdminClient,
  organizationId: string,
  refs: Partial<Record<OrgRefField, unknown>>,
): Promise<OrgRefField | null> {
  for (const field of Object.keys(refs) as OrgRefField[]) {
    const value = refs[field];
    if (value == null || value === "") continue; // field not being set
    if (typeof value !== "string") return field; // malformed id
    const table = REF_TABLES[field];
    const { data, error } = (await admin
      .from(table as never)
      .select("id")
      .eq("id" as never, value as never)
      .eq("organization_id" as never, organizationId as never)
      .maybeSingle()) as unknown as {
      data: { id: string } | null;
      error: { message: string } | null;
    };
    if (error || !data) return field;
  }
  return null;
}
