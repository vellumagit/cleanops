import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageShell } from "@/components/page-shell";
import { SenderEmailForm } from "./sender-email-form";
import { ContactInfoForm } from "./contact-info-form";

export const metadata = { title: "Email & contact info" };

export default async function EmailSettingsPage() {
  const membership = await requireMembership(["owner", "admin"]);
  const admin = createSupabaseAdminClient();

  const { data } = await admin
    .from("organizations")
    .select(
      "sender_email, sender_email_verified_at, contact_email, contact_phone",
    )
    .eq("id", membership.organization_id)
    .maybeSingle();

  const org = data as {
    sender_email: string | null;
    sender_email_verified_at: string | null;
    contact_email: string | null;
    contact_phone: string | null;
  } | null;

  return (
    <PageShell
      title="Email & contact info"
      description="How you email clients, and how they reach you back."
      actions={
        <Link
          href="/app/settings"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Settings
        </Link>
      }
    >
      <div className="space-y-10">
        <section>
          <h2 className="text-sm font-semibold">Sender email</h2>
          <p className="mb-4 mt-0.5 text-xs text-muted-foreground">
            The From address on invoices, booking confirmations, and review
            requests. Leave blank to use the default
            (<code>noreply@sollos3.com</code>).
          </p>
          <SenderEmailForm
            currentEmail={org?.sender_email ?? null}
            isVerified={Boolean(org?.sender_email_verified_at)}
          />
        </section>

        <section className="border-t border-border pt-8">
          <h2 className="text-sm font-semibold">Contact info on invoices</h2>
          <p className="mb-4 mt-0.5 text-xs text-muted-foreground">
            Shown on the public invoice page so clients know where to send
            questions. Contact email is also used as the Reply-To header on
            outgoing emails.
          </p>
          <ContactInfoForm
            currentEmail={org?.contact_email ?? null}
            currentPhone={org?.contact_phone ?? null}
          />
        </section>
      </div>
    </PageShell>
  );
}
