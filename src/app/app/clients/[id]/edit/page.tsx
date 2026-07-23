import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { ClientForm } from "../../client-form";
import { fetchClientFormCleaners, fetchReferralClients } from "../../options";
import { fetchOrgContactDefault } from "../../org-contact-default";
import { DeleteClientForm } from "./delete-form";
import { PortalInviteCard } from "./portal-invite-card";

export const metadata = { title: "Edit client" };

export default async function EditClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const membership = await requireMembership(["owner", "admin", "manager"]);
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const [clientResult, cleaners, referralClients] = await Promise.all([
    supabase
      .from("clients")
      .select(
        "id, name, email, phone, address, notes, preferred_contact, contact_preference, contact_overrides, preferred_cleaner_id, sms_opted_in, profile_id, portal_invited_at, portal_accepted_at, portal_invite_expires_at, billing_cadence, billing_type, flat_rate_cents, referred_by_client_id",
      )
      .eq("id", id)
      .maybeSingle() as unknown as Promise<{
      data: {
        id: string;
        name: string;
        email: string | null;
        phone: string | null;
        address: string | null;
        notes: string | null;
        preferred_contact: string;
        contact_preference: string | null;
        contact_overrides: Record<string, string> | null;
        preferred_cleaner_id: string | null;
        sms_opted_in: boolean;
        profile_id: string | null;
        portal_invited_at: string | null;
        portal_accepted_at: string | null;
        portal_invite_expires_at: string | null;
        billing_cadence: string;
        billing_type: string;
        flat_rate_cents: number | null;
        referred_by_client_id: string | null;
      } | null;
      error: { message: string } | null;
    }>,
    fetchClientFormCleaners(),
    fetchReferralClients(id),
  ]);
  const orgContactDefault = await fetchOrgContactDefault(
    membership.organization_id,
  );
  const { data: client, error } = clientResult;

  if (error) throw error;
  if (!client) notFound();

  return (
    <PageShell title="Edit client" description={client.name}>
      <div className="max-w-2xl space-y-6">
        <div className="rounded-lg border border-border bg-card p-6">
          <ClientForm
            mode="edit"
            id={client.id}
            cleaners={cleaners}
            referralClients={referralClients}
            orgContactDefault={orgContactDefault}
            defaults={{
              name: client.name,
              email: client.email,
              phone: client.phone,
              address: client.address,
              notes: client.notes,
              preferred_contact: client.preferred_contact,
              contact_preference: client.contact_preference,
              contact_overrides: client.contact_overrides,
              preferred_cleaner_id: client.preferred_cleaner_id,
              sms_opted_in: client.sms_opted_in,
              billing_cadence: client.billing_cadence,
              billing_type: client.billing_type,
              flat_rate_cents: client.flat_rate_cents,
              referred_by_client_id: client.referred_by_client_id,
            }}
          />
        </div>

        <PortalInviteCard
          clientId={client.id}
          clientEmail={client.email}
          hasPortalAccess={!!client.profile_id}
          portalInvitedAt={client.portal_invited_at}
          portalAcceptedAt={client.portal_accepted_at}
          portalInviteExpiresAt={client.portal_invite_expires_at}
        />

        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6">
          <h2 className="text-sm font-semibold text-destructive">
            Danger zone
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Deleting this client will fail if they have bookings, estimates,
            contracts, or invoices attached. Cancel those records first.
          </p>
          <div className="mt-4">
            <DeleteClientForm id={client.id} />
          </div>
        </div>
      </div>
    </PageShell>
  );
}
