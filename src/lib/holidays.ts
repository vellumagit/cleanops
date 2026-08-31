import "server-only";
import Holidays from "date-holidays";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Statutory holidays, computed offline from the org's region setting
 * (organizations.holiday_region, "CA" or "CA-AB"). No Google Calendar,
 * no API, no sync: date-holidays ships the rules for ~200 countries and
 * their subdivisions, so scaling past Canada is a dropdown, not an
 * integration.
 *
 * Only type "public" (statutory) holidays are surfaced — observances and
 * bank days would turn the scheduler into a novelty calendar.
 */

const instanceCache = new Map<string, Holidays>();

function parseRegion(region: string): { country: string; state?: string } {
  const [country, state] = region.split("-");
  return { country, state };
}

function holidaysInstance(region: string): Holidays {
  let hd = instanceCache.get(region);
  if (!hd) {
    const { country, state } = parseRegion(region);
    hd = state ? new Holidays(country, state) : new Holidays(country);
    instanceCache.set(region, hd);
  }
  return hd;
}

/** True when the region code resolves to a real country in the dataset. */
export function isValidHolidayRegion(region: string): boolean {
  if (!/^[A-Z]{2}(-[A-Z0-9]{1,4})?$/.test(region)) return false;
  const { country, state } = parseRegion(region);
  const hd = new Holidays();
  const countries = hd.getCountries() ?? {};
  if (!(country in countries)) return false;
  if (state) {
    const states = hd.getStates(country) ?? {};
    if (!(state in states)) return false;
  }
  return true;
}

/**
 * Public holidays inside [startYmd, endYmdExclusive), as YMD → name.
 * Multiple holidays on one date join with " · ". Dates are the org
 * region's own wall-clock calendar dates — exactly what a scheduler
 * keyed on org-local days wants.
 */
export function holidaysForRange(
  region: string,
  startYmd: string,
  endYmdExclusive: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  let hd: Holidays;
  try {
    hd = holidaysInstance(region);
  } catch {
    return out; // an unknown region shows no holidays, never an error page
  }

  const startYear = Number(startYmd.slice(0, 4));
  const endYear = Number(endYmdExclusive.slice(0, 4));
  for (let year = startYear; year <= endYear; year++) {
    for (const h of hd.getHolidays(year) ?? []) {
      if (h.type !== "public") continue;
      // h.date is the wall-clock START day. A handful of countries have
      // multi-day publics (Seollal, Eid) whose later days go unlabeled —
      // acceptable for now; substitute days arrive as their own entries.
      const ymd = String(h.date).slice(0, 10);
      if (ymd < startYmd || ymd >= endYmdExclusive) continue;
      out[ymd] = out[ymd] ? `${out[ymd]} · ${h.name}` : h.name;
    }
  }
  return out;
}

/** The org's holidays for a range — empty when the setting is unset. */
export async function getOrgHolidays(
  organizationId: string,
  startYmd: string,
  endYmdExclusive: string,
): Promise<Record<string, string>> {
  const admin = createSupabaseAdminClient();
  const { data } = (await admin
    .from("organizations")
    .select("holiday_region" as never)
    .eq("id", organizationId)
    .maybeSingle()) as unknown as {
    data: { holiday_region: string | null } | null;
  };
  const region = data?.holiday_region;
  if (!region) return {};
  return holidaysForRange(region, startYmd, endYmdExclusive);
}

export type RegionOptions = {
  countries: Array<{ code: string; name: string }>;
  /** country code → subdivisions, only for countries that have them. */
  states: Record<string, Array<{ code: string; name: string }>>;
};

/** Country + subdivision lists for the settings form (~20 KB total).
 *  English names so the dropdown sorts in one script; codes that can't
 *  pass validation (Cook Islands uses full-word subdivision codes) are
 *  filtered so the form never offers a choice the save would reject. */
export function regionOptions(): RegionOptions {
  const hd = new Holidays();
  const countries = Object.entries(hd.getCountries("en") ?? {})
    .map(([code, name]) => ({ code, name: String(name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const states: RegionOptions["states"] = {};
  for (const c of countries) {
    const s = hd.getStates(c.code, "en");
    if (!s) continue;
    const entries = Object.entries(s)
      .filter(([code]) => /^[A-Z0-9]{1,4}$/.test(code))
      .map(([code, name]) => ({ code, name: String(name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (entries.length > 0) states[c.code] = entries;
  }
  return { countries, states };
}
