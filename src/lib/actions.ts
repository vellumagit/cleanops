/**
 * Shared helpers for server-action CRUD handlers.
 *
 * Every action helper here:
 *   1. Calls requireMembership() so unauthenticated requests die fast.
 *   2. Returns the active membership + a Supabase server client tied to
 *      the caller's session, so RLS still applies on every query.
 *
 * We never use the admin client from the ops console — RLS at the
 * Postgres level is the real source of truth, and bypassing it from
 * a server action defeats the entire multi-tenant design.
 */

import "server-only";

import { z } from "zod";
import { requireMembership, type CurrentMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** A field-level error map keyed by form field name. */
export type FieldErrors<F extends string> = Partial<Record<F | "_form", string>>;

export type ActionState<F extends string, V = Record<string, string>> = {
  errors?: FieldErrors<F>;
  values?: Partial<V>;
};

/**
 * Pull the active membership + supabase client. Throws redirect to /login if
 * the caller isn't signed in.
 */
export async function getActionContext(): Promise<{
  membership: CurrentMembership;
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
}> {
  const membership = await requireMembership();
  const supabase = await createSupabaseServerClient();
  return { membership, supabase };
}

/**
 * Run a zod schema against raw form data and either return the parsed
 * values, or a populated ActionState with field errors + the original
 * values so the form can re-render.
 */
export function parseForm<S extends z.ZodTypeAny>(
  schema: S,
  raw: Record<string, unknown>,
):
  | { ok: true; data: z.infer<S> }
  | { ok: false; errors: Record<string, string> } {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? "_form");
    if (!errors[key]) errors[key] = issue.message;
  }
  return { ok: false, errors };
}
