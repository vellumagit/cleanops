import Link from "next/link";
import { redirect } from "next/navigation";
import { requireClient } from "@/lib/client-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { clientBookingOffer } from "@/lib/booking-page";
import { publicPrice } from "@/lib/booking-page-rules";
import { formatCurrencyCents, formatDurationMinutes } from "@/lib/format";
import { brandButtonColors } from "@/lib/readable-on";
import { onSiteMinutes } from "@/lib/open-times";
import { orgDividesCrewHours } from "@/lib/crew-hours";
import { getOrgCurrency } from "@/lib/org-currency";
import { TimePicker } from "@/app/book/[slug]/time/time-picker";
import { clientBookTimeAction, clientOpenTimesAction } from "./actions";

export const metadata = { title: "Book a clean" };
export const dynamic = "force-dynamic";

/**
 * "Book a clean" for a signed-in client: the company's own picker (service,
 * day, time), with their address filled in and nothing else to type
 * (roadmap phase 6, 2026-11-25). Only where the company takes bookings on
 * its page; anywhere else this is the request form, as it always was.
 */
export default async function ClientBookPage() {
  const client = await requireClient();
  const offer = await clientBookingOffer(client.organization_id);
  if (!offer) redirect("/client/request");

  const supabase = await createSupabaseServerClient();
  const [{ data: me }, { data: org }, shares, currency] = await Promise.all([
    supabase.from("clients").select("address").eq("id", client.id).maybeSingle() as unknown as Promise<{
      data: { address: string | null } | null;
    }>,
    // A client can't read organizations; only these display fields, past RLS.
    createSupabaseAdminClient()
      .from("organizations")
      .select("name, brand_color, contact_phone" as never)
      .eq("id", client.organization_id)
      .maybeSingle() as unknown as Promise<{
      data: { name: string; brand_color: string | null; contact_phone: string | null } | null;
    }>,
    orgDividesCrewHours(client.organization_id),
    getOrgCurrency(client.organization_id),
  ]);
  const company = org?.name ?? client.organization_name;
  const held = offer.page.time_booking === "approve";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Book a clean</h1>
        <p className="mt-1 text-base text-muted-foreground">
          Pick a time that suits you.{" "}
          {held ? `${company} confirms it by email.` : "It's booked straight away."}
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-5">
        <TimePicker
          slug={offer.page.slug}
          loadTimes={clientOpenTimesAction}
          bookAction={clientBookTimeAction}
          signedIn={{ address: me?.address ?? null }}
          companyName={company}
          phone={org?.contact_phone?.trim() || null}
          held={held}
          services={offer.services.map((s) => ({
            id: s.id,
            name: s.name,
            length: `About ${formatDurationMinutes(onSiteMinutes(s.default_duration_minutes ?? 0, s.online_crew_size, shares))}`,
            price: publicPrice(s.booking_page_price, s.default_price_cents, (cents) => formatCurrencyCents(cents, currency)),
          }))}
          button={brandButtonColors(org?.brand_color ?? null)}
          turnstileSiteKey={null}
          preview={false}
        />
      </div>

      <p className="text-base text-muted-foreground">
        Rather we found a time for you?{" "}
        <Link href="/client/request" className="font-medium text-foreground underline underline-offset-4">
          Ask for a clean instead
        </Link>
        .
      </p>
    </div>
  );
}
