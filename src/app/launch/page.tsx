import { redirect } from "next/navigation";
import { getCurrentMembership, getCurrentUserId } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * The installed app's front door. The PWA manifest points start_url here
 * so ONE home-screen icon serves every role: workers open the field app,
 * owners/admins/managers the office, portal clients their portal, and a
 * signed-out phone lands on login — never the marketing page, which stays
 * the deliberate destination for visiting / in a browser tab.
 *
 * (The manifest used to hard-code /field/jobs, which made the installed
 * app field-only no matter who installed it. Icons installed before this
 * change keep the old start_url until reinstalled — harmless, since
 * everyone who had a reason to install then was a field worker.)
 */
export default async function LaunchPage() {
  const membership = await getCurrentMembership();
  if (membership) {
    redirect(membership.role === "employee" ? "/field/jobs" : "/app");
  }

  const { getCurrentClient } = await import("@/lib/client-auth");
  const client = await getCurrentClient();
  if (client) redirect("/client");

  // Signed in but no active membership (offboarded, invite not accepted):
  // /no-access explains it — /login would let them "sign in" and bounce
  // right back here. Same distinction requireMembership draws.
  const userId = await getCurrentUserId();
  redirect(userId ? "/no-access" : "/login");
}
