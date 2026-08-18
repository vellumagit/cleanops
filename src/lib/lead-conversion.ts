import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { conversionPatch } from "@/lib/lead-pipeline";

/**
 * Booking someone IS the close.
 *
 * In a cleaning business nobody schedules a job for a person who hasn't agreed
 * to buy. So the moment a booking is created for a lead, they are a client —
 * and making Svitlana ALSO remember to press "Won" would mean the pipeline
 * quietly fills with people who have been on the books for weeks.
 *
 * Guarded on lifecycle = 'lead', so this can only ever promote. It will never
 * touch an existing client, and never resurrect someone marked lost — reopening
 * a lost lead is a deliberate act with its own button.
 *
 * Best-effort and silent on failure: a booking must not fail because a
 * lifecycle flip didn't take. The worst case is a lead who stays in the list
 * until someone presses Won, which is exactly where we were before this
 * existed.
 */
export async function convertLeadOnBooking(
  clientId: string | null | undefined,
): Promise<void> {
  if (!clientId) return;
  try {
    const admin = createSupabaseAdminClient();
    const { data } = (await admin
      .from("clients")
      .update(conversionPatch() as never)
      .eq("id", clientId)
      .eq("lifecycle" as never, "lead" as never)
      .select("id")) as unknown as { data: Array<{ id: string }> | null };

    if (data && data.length > 0) {
      console.log(`[leads] ${clientId} converted to client on booking`);
    }
  } catch (err) {
    console.error("[leads] convertLeadOnBooking failed:", err);
  }
}
