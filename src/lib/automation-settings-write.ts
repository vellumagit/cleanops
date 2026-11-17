import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type AutomationSettings = Record<string, Record<string, unknown>>;

/**
 * Change one of a company's settings objects (a JSON column holding many
 * settings) without losing a change made at the same moment.
 *
 * Every switch on the Automations page read the whole settings object,
 * changed one entry and wrote the whole object back. Two switches flipped
 * close together both started from the same copy, and the second write put
 * the first switch back where it was: "I turned it off and it came back on".
 * Found 2026-11-16 by a test that flips two at once. The tipping settings,
 * edited from two different screens, had the same shape.
 *
 * Now the write only lands if the row is unchanged since it was read
 * (organizations.updated_at, which a trigger moves on every update); if
 * someone else got there first, it reads again and re-applies its change on
 * top of theirs. `extra` is any other column to set in the same write.
 */
export async function updateOrgSettingsColumn<T>(
  organizationId: string,
  column: "automation_settings" | "tipping_settings",
  change: (current: T | null) => T,
  extra: Record<string, unknown> = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createSupabaseAdminClient();
  for (let attempt = 1; attempt <= 6; attempt++) {
    const { data: org, error: readErr } = (await admin
      .from("organizations")
      .select(`${column}, updated_at`)
      .eq("id", organizationId)
      .maybeSingle()) as unknown as {
      data: (Record<string, unknown> & { updated_at: string }) | null;
      error: { message: string } | null;
    };
    if (readErr) return { ok: false, error: readErr.message };
    if (!org) return { ok: false, error: "Company not found." };

    const { data: written, error } = (await admin
      .from("organizations")
      .update({ [column]: change((org[column] as T | null) ?? null), ...extra } as never)
      .eq("id", organizationId)
      .eq("updated_at", org.updated_at)
      .select("id")) as unknown as {
      data: Array<{ id: string }> | null;
      error: { message: string } | null;
    };
    if (error) return { ok: false, error: error.message };
    if (written && written.length > 0) return { ok: true };
  }
  return {
    ok: false,
    error: "Other changes to these settings kept landing at the same moment. Refresh the page and try again.",
  };
}

/** The Automations page's switches, thresholds and cadences. */
export function updateAutomationSettings(
  organizationId: string,
  change: (current: AutomationSettings) => AutomationSettings,
  extra: Record<string, unknown> = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  return updateOrgSettingsColumn<AutomationSettings>(
    organizationId,
    "automation_settings",
    (current) => change(current ?? {}),
    extra,
  );
}
