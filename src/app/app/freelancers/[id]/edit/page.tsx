import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { FreelancerForm } from "../../freelancer-form";
import { DeleteFreelancerForm } from "./delete-form";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Edit freelancer" };

export default async function EditFreelancerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireMembership(["owner", "admin", "manager"]);
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: contact, error } = await supabase
    .from("freelancer_contacts")
    .select(
      "id, full_name, phone, email, notes, active, last_offered_at, last_accepted_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!contact) notFound();

  // Recent offer history for this contact
  const { data: dispatches } = await supabase
    .from("job_offer_dispatches")
    .select(
      "id, delivery_status, sent_at, responded_at, offer:job_offers ( id, status, pay_cents, booking:bookings ( id, scheduled_at, service_type ) )",
    )
    .eq("contact_id", id)
    .order("sent_at", { ascending: false })
    .limit(15);

  return (
    <PageShell title="Edit freelancer">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <div className="rounded-lg border border-border bg-card p-6">
            <FreelancerForm
              mode="edit"
              id={contact.id}
              defaults={{
                full_name: contact.full_name,
                phone: contact.phone,
                email: contact.email,
                notes: contact.notes,
                active: contact.active,
              }}
            />
          </div>
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6">
            <h2 className="text-sm font-semibold text-destructive">
              Danger zone
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Removing a freelancer detaches them from the bench but keeps
              their offer history intact.
            </p>
            <div className="mt-4">
              <DeleteFreelancerForm id={contact.id} />
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="sollos-label">Bench activity</p>
            <dl className="mt-3 space-y-2 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Last offered</dt>
                <dd className="font-medium text-foreground">
                  {formatDateTime(contact.last_offered_at)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Last accepted</dt>
                <dd className="font-medium text-foreground">
                  {formatDateTime(contact.last_accepted_at)}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <p className="sollos-label">Recent offers</p>
            {!dispatches || dispatches.length === 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">
                This freelancer hasn&rsquo;t been offered a shift yet.
              </p>
            ) : (
              <ul className="mt-3 space-y-2 text-xs">
                {dispatches.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-start justify-between gap-2 border-b border-border/60 pb-2 last:border-b-0 last:pb-0"
                  >
                    <div>
                      <p className="font-medium text-foreground">
                        {d.offer?.booking?.service_type?.replace(/_/g, " ") ??
                          "Shift"}
                      </p>
                      <p className="text-muted-foreground">
                        {formatDateTime(d.sent_at)}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {d.delivery_status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </PageShell>
  );
}
