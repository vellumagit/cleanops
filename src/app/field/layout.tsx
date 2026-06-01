import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { FieldShell } from "@/components/field-shell";
import { BrandProvider } from "@/components/brand-provider";
import { PushPrompt } from "@/components/push-prompt";
import { isFeedVisible } from "@/lib/feed-visibility";

export default async function FieldLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Field app is open to every active member, including owners/admins so
  // they can dogfood it. RLS still scopes data to their org.
  //
  // TEMP DIAGNOSTIC: wrapping the data-fetch in try/catch so a crash
  // in the layout doesn't propagate to /field/error.tsx (where Next's
  // prod-build error scrubbing hides the actual message). We render a
  // minimal in-page panel that shows the real error text. Remove
  // once the regression is root-caused.
  let stage = "init";
  try {
    stage = "requireMembership";
    const membership = await requireMembership();
    stage = "createSupabaseServerClient";
    const supabase = await createSupabaseServerClient();

    stage = "Promise.all (profile + org + feedEnabled)";
    const [{ data: profile }, { data: org }, feedEnabled] = await Promise.all([
      supabase
        .from("profiles")
        .select("full_name")
        .eq("id", membership.profile_id)
        .maybeSingle(),
      supabase
        .from("organizations")
        .select("logo_url, brand_color")
        .eq("id", membership.organization_id)
        .maybeSingle() as unknown as {
        data: { logo_url: string | null; brand_color: string | null } | null;
      },
      isFeedVisible(membership.organization_id),
    ]);

    stage = "render";
    return (
      <BrandProvider brandColor={org?.brand_color ?? null}>
        <FieldShell
          organizationName={membership.organization_name}
          userName={profile?.full_name ?? null}
          logoUrl={org?.logo_url ?? null}
          brandColor={org?.brand_color ?? null}
          role={membership.role}
          feedEnabled={feedEnabled}
        >
          <PushPrompt
            membershipId={membership.id}
            organizationId={membership.organization_id}
          />
          {children}
        </FieldShell>
      </BrandProvider>
    );
  } catch (err) {
    // TEMP — see comment at top of try block.
    if (
      err &&
      typeof err === "object" &&
      typeof (err as { digest?: string }).digest === "string" &&
      (err as { digest: string }).digest.startsWith("NEXT_")
    ) {
      // Don't swallow Next's internal redirect / not-found signals.
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : null;
    return (
      <div className="min-h-[100dvh] bg-muted/30 px-4 py-6">
        <div className="mx-auto max-w-md space-y-3 rounded-lg border border-red-200 bg-red-50 p-4 text-xs dark:border-red-900/40 dark:bg-red-950/30">
          <h2 className="text-sm font-semibold text-red-900 dark:text-red-200">
            Diagnostic — field layout crashed
          </h2>
          <p className="text-red-800 dark:text-red-300">
            <strong>Stage:</strong> {stage}
          </p>
          <p className="break-words text-red-800 dark:text-red-300">
            <strong>Error:</strong> {msg || "(no message)"}
          </p>
          {stack && (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-red-100 p-2 text-[10px] text-red-900 dark:bg-red-950/50 dark:text-red-200">
              {stack}
            </pre>
          )}
        </div>
      </div>
    );
  }
}
