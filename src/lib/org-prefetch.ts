/**
 * Organization settings, read once per page render instead of once per helper.
 *
 * Every /app page used to open with the same five reads of the same row:
 * getOrgTimezone, getOrgCurrency, isFeedVisible, orgDividesCrewHours and
 * getSubscriptionInfo each asked `organizations` for one or two columns, and
 * each had to wait for requireMembership to name the org first. That put a
 * whole extra round trip to the database in front of nearly every page,
 * after the membership query, before the page's own data. Measured on the
 * test stack (2026-11-21): the layout and dashboard spent a full level of
 * their critical path on it.
 *
 * getCurrentMembership() already joins `organizations` to read the name, so
 * it now reads these columns in the same query and leaves them here. The
 * helpers look here first and fall back to their own query on a miss.
 *
 * Scope is one React render (React `cache`). Outside a render — a server
 * action, a route handler, a cron — `cache` does not memoize, so every call
 * gets a fresh empty map and the helpers query as they always did. Nothing
 * here can serve a value older than the render asking for it.
 */
import "server-only";
import { cache } from "react";

export type PrefetchedOrgSettings = {
  timezone?: string | null;
  currency_code?: string | null;
  automation_settings?: Record<string, { enabled?: boolean } | undefined> | null;
  billing_override?: string | null;
  trial_started_at?: string | null;
  automations_enabled?: boolean | null;
  quiet_mode?: boolean | null;
};

/** The organizations columns getCurrentMembership reads alongside the name. */
export const PREFETCHED_ORG_COLUMNS =
  "timezone, currency_code, automation_settings, billing_override, trial_started_at, automations_enabled, quiet_mode";

const store = cache(() => new Map<string, PrefetchedOrgSettings>());

export function primeOrgSettings(organizationId: string, row: PrefetchedOrgSettings): void {
  store().set(organizationId, row);
}

/** This render's copy of the org's settings, or undefined (then query). */
export function prefetchedOrgSettings(organizationId: string): PrefetchedOrgSettings | undefined {
  return store().get(organizationId);
}
