import Link from "next/link";
import { Plus, Send } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { FreelancersTable, type FreelancerRow } from "./freelancers-table";
import { isTwilioEnabled } from "@/lib/twilio";

export const metadata = { title: "Freelancer bench" };

export default async function FreelancersPage() {
  const membership = await requireMembership(["owner", "admin"]);
  const canEdit = true;
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("freelancer_contacts")
    .select(
      "id, full_name, phone, email, active, last_offered_at, last_accepted_at",
    )
    .order("created_at", { ascending: false });

  if (error) throw error;

  const rows: FreelancerRow[] = data ?? [];
  const twilioOn = isTwilioEnabled();

  return (
    <PageShell
      title="Freelancer bench"
      description="Off-platform cleaners you can text when you need emergency coverage."
      actions={
        <div className="flex items-center gap-2">
          <Link
            href="/app/freelancers/offers"
            className={buttonVariants({ variant: "outline" })}
          >
            <Send className="h-4 w-4" />
            Offers
          </Link>
          <Link
            href="/app/freelancers/new"
            className={buttonVariants({ variant: "default" })}
          >
            <Plus className="h-4 w-4" />
            New freelancer
          </Link>
        </div>
      }
    >
      {!twilioOn && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
          <span className="font-semibold">Twilio is disabled.</span> Offers
          can still be created — each dispatch row is marked{" "}
          <code className="font-mono text-[11px]">skipped_disabled</code> and
          you can test the full claim flow by clicking the preview links on
          the offer detail page. Flip <code>TWILIO_ENABLED=true</code> when
          you&rsquo;re ready to start sending real SMS.
        </div>
      )}
      <FreelancersTable rows={rows} canEdit={canEdit} />
    </PageShell>
  );
}
