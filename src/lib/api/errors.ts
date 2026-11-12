import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * A failure on our side, answered to a public API caller (/api/v1/*).
 *
 * The routes used to return the database's own message: table and
 * constraint names, column types, a policy's wording. That is a map of the
 * schema for anyone holding a key, and no help to an integration. The
 * caller now gets a plain sentence and a short reference; the full detail
 * goes to the log under the same reference, so support can find it.
 */
export function apiServerError(context: string, err: unknown, status = 500): NextResponse {
  const ref = randomUUID().slice(0, 8);
  const detail =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err !== null && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err);
  console.error(`[api] ${context} failed (ref ${ref}):`, detail);
  return NextResponse.json(
    { error: "Something went wrong on our side. Try again; if it keeps happening, contact support with this reference.", ref },
    { status },
  );
}
