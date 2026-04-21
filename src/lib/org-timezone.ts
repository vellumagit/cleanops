import "server-only";
import { cache } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_TZ } from "@/lib/format";

/**
 * Fetch the IANA timezone for an organization. Cached per-request via
 * React's `cache()` — a page that calls this in multiple server components
 * hits the DB once. Falls back to the global DEFAULT_TZ on any error;
 * timezone is a display concern, never block rendering on a lookup miss.
 *
 * Used by:
 *   - The booking form to round-trip datetime-local inputs
 *   - The recurrence generator to apply start_time correctly across DST
 *   - Email templates that show wall-clock times to clients / employees
 */
export const getOrgTimezone = cache(
  async (organizationId: string): Promise<string> => {
    try {
      const admin = createSupabaseAdminClient();
      const { data } = await admin
        .from("organizations")
        .select("timezone")
        .eq("id", organizationId)
        .maybeSingle() as unknown as {
        data: { timezone: string | null } | null;
      };
      const tz = data?.timezone;
      if (tz && isValidIanaTz(tz)) return tz;
      return DEFAULT_TZ;
    } catch {
      return DEFAULT_TZ;
    }
  },
);

/**
 * Lightweight IANA timezone validation via Intl.DateTimeFormat. Returns
 * true if the runtime accepts the string as a timezone. Blocks garbage
 * like "Mars/Olympus" from propagating through the app.
 */
export function isValidIanaTz(tz: string): boolean {
  if (!tz || typeof tz !== "string") return false;
  try {
    // Throws `RangeError: Invalid time zone specified` on bad input.
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * A curated list of common IANA timezones that covers all Canadian
 * provinces + the most common US + a few international options. Used to
 * populate the Settings dropdown so owners don't have to type raw strings.
 */
export const COMMON_TIMEZONES: Array<{ value: string; label: string }> = [
  // Canada
  { value: "America/St_Johns", label: "Newfoundland (St. John's)" },
  { value: "America/Halifax", label: "Atlantic (Halifax)" },
  { value: "America/Toronto", label: "Eastern (Toronto, Ottawa)" },
  { value: "America/Winnipeg", label: "Central (Winnipeg, Saskatoon)" },
  { value: "America/Regina", label: "Central — no DST (Regina)" },
  { value: "America/Edmonton", label: "Mountain (Edmonton, Calgary)" },
  { value: "America/Vancouver", label: "Pacific (Vancouver)" },
  { value: "America/Whitehorse", label: "Yukon (Whitehorse)" },
  // United States
  { value: "America/New_York", label: "US Eastern (New York)" },
  { value: "America/Chicago", label: "US Central (Chicago)" },
  { value: "America/Denver", label: "US Mountain (Denver)" },
  { value: "America/Phoenix", label: "US Mountain — no DST (Phoenix)" },
  { value: "America/Los_Angeles", label: "US Pacific (Los Angeles)" },
  { value: "America/Anchorage", label: "US Alaska (Anchorage)" },
  { value: "Pacific/Honolulu", label: "US Hawaii (Honolulu)" },
  // Other
  { value: "UTC", label: "UTC" },
];
