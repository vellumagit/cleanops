/**
 * Which deployment is actually serving right now. The update beacon polls
 * this and compares against the sha baked into its own bundle — a mismatch
 * means the open tab predates the current deploy, and its Save buttons
 * carry server-action IDs the server no longer recognizes (Next recovers
 * from those with a silent quick reload that discards the change).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    { sha: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? "dev" },
    { headers: { "cache-control": "no-store" } },
  );
}
