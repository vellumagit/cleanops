import Link from "next/link";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { checkIpRateLimit } from "@/lib/rate-limit-helpers";
import { getOrgTimezone } from "@/lib/org-timezone";
import { brandButtonColors } from "@/lib/readable-on";
import { visitByToken } from "@/lib/visit-link";
import { visitMoveState } from "@/lib/visit-move";
import { whenLabel } from "@/lib/online-booking";
import { MovePicker } from "./move-picker";

export const metadata = { title: "Move your clean", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Move one visit to another open time, from the private link in a booking
 * email (roadmap phase 4). No sign-in: holding the link is the permission.
 *
 * When it can't be moved here, the page says why and what to do instead,
 * and never offers a button that would then be refused.
 */
export default async function MoveVisitPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limit = await checkIpRateLimit("visit-link", 60, 60_000);
  const visit = limit.allowed ? await visitByToken(token) : null;

  if (!visit) {
    return (
      <Frame>
        <h1 className="text-2xl font-bold">{limit.allowed ? "This link has stopped working" : "One moment"}</h1>
        <p className="mt-2 text-base text-muted-foreground">
          {limit.allowed
            ? "It may be for a visit that is long past. To see your cleans, type your email on the next page and we'll send you a new link."
            : "That's a lot of visits to this page. Wait a minute and open the link again."}
        </p>
        {limit.allowed && (
          <Link href="/client/login" className="mt-6 flex min-h-14 w-full items-center justify-center rounded-xl bg-primary px-5 text-lg font-semibold text-primary-foreground">
            See my cleans
          </Link>
        )}
      </Frame>
    );
  }

  const admin = createSupabaseAdminClient();
  const [tz, orgRes, move] = await Promise.all([
    getOrgTimezone(visit.organization_id),
    admin.from("organizations").select("name, logo_url, brand_color, contact_phone" as never).eq("id", visit.organization_id).maybeSingle() as unknown as Promise<{
      data: { name: string; logo_url: string | null; brand_color: string | null; contact_phone: string | null } | null;
    }>,
    visitMoveState(visit),
  ]);
  const org = orgRes.data;
  const companyName = org?.name ?? "your cleaning company";

  return (
    <Frame>
      <div className="flex items-center gap-3">
        {org?.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- the company's own logo, from its own storage
          <img src={org.logo_url} alt="" className="h-10 w-auto max-w-[9rem] object-contain" />
        ) : null}
        <p className="text-base font-semibold">{companyName}</p>
      </div>
      <h1 className="mb-4 mt-6 text-2xl font-bold tracking-tight">Move your clean</h1>

      {move.allowed ? (
        <MovePicker token={token} companyName={companyName} current={whenLabel(new Date(visit.scheduled_at).getTime(), tz)} button={brandButtonColors(org?.brand_color)} />
      ) : (
        <p className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-base" data-testid="cant-move">
          {move.reason}
        </p>
      )}

      <div className="mt-8 space-y-3 border-t border-border pt-5 text-base">
        <p>
          <Link href={`/v/${token}`} className="font-medium underline underline-offset-4">
            Back to my clean
          </Link>
        </p>
        {org?.contact_phone ? (
          <p>
            Rather talk to someone? Call {companyName} at{" "}
            <a href={`tel:${org.contact_phone.replace(/[^\d+]/g, "")}`} className="font-semibold underline underline-offset-4">
              {org.contact_phone}
            </a>
            .
          </p>
        ) : null}
      </div>
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] justify-center bg-muted/30 px-4 py-8">
      <main className="h-fit w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">{children}</main>
    </div>
  );
}
