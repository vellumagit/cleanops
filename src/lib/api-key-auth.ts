/**
 * API key authentication for /api/v1/* routes.
 *
 * Every public REST API route calls `authenticateApiKey(request)` at the top.
 * It extracts the Bearer token, hashes it, looks up the key in the DB, and
 * returns the org context. If anything is wrong it returns a ready-made
 * JSON error response.
 *
 * Because these routes have no cookie/session, all Supabase queries in the
 * handler must use `createSupabaseAdminClient()` scoped by `organizationId`.
 */

import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { hashApiKey, isValidKeyFormat } from "@/lib/api-keys";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rate-limit";

type AuthSuccess = {
  ok: true;
  organizationId: string;
  apiKeyId: string;
};

type AuthFailure = {
  ok: false;
  response: NextResponse;
};

export type ApiKeyAuth = AuthSuccess | AuthFailure;

function jsonError(status: number, message: string, headers?: Record<string, string>) {
  return NextResponse.json({ error: message }, { status, headers });
}

/**
 * Authenticate an incoming API request via Bearer token.
 *
 * Usage:
 * ```ts
 * const auth = await authenticateApiKey(request);
 * if (!auth.ok) return auth.response;
 * // auth.organizationId is now safe to use
 * ```
 */
export async function authenticateApiKey(
  request: NextRequest,
): Promise<ApiKeyAuth> {
  // 1. Extract Bearer token
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return {
      ok: false,
      response: jsonError(401, "Missing or malformed Authorization header. Expected: Bearer sk_live_..."),
    };
  }

  const rawKey = authHeader.slice("Bearer ".length).trim();
  if (!isValidKeyFormat(rawKey)) {
    return {
      ok: false,
      response: jsonError(401, "Invalid API key format"),
    };
  }

  // 2. Hash and look up
  const keyHash = hashApiKey(rawKey);
  const admin = createSupabaseAdminClient();

  const { data: keyRow, error } = await admin
    .from("api_keys" as never)
    .select("id, organization_id, revoked_at")
    .eq("key_hash", keyHash)
    .maybeSingle();

  if (error || !keyRow) {
    return {
      ok: false,
      response: jsonError(401, "Invalid API key"),
    };
  }

  const row = keyRow as unknown as {
    id: string;
    organization_id: string;
    revoked_at: string | null;
  };

  if (row.revoked_at) {
    return {
      ok: false,
      response: jsonError(401, "API key has been revoked"),
    };
  }

  // 3. Rate limit by org
  const limit = checkRateLimit(`api:${row.organization_id}`);
  if (!limit.allowed) {
    return {
      ok: false,
      response: jsonError(429, "Rate limit exceeded", {
        "Retry-After": String(limit.retryAfterSeconds),
      }),
    };
  }

  // 4. Touch last_used_at (fire-and-forget)
  admin
    .from("api_keys" as never)
    .update({ last_used_at: new Date().toISOString() } as never)
    .eq("id" as never, row.id as never)
    .then(() => {});

  return {
    ok: true,
    organizationId: row.organization_id,
    apiKeyId: row.id,
  };
}
