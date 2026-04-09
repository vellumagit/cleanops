import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { PaymentMethodsForm } from "./payment-methods-form";

export const metadata = { title: "Payment instructions" };

/**
 * Payment instructions — the manual/offline payment methods your org
 * wants to show on every invoice. Zelle handle, check mailing address,
 * bank wire details, etc.
 *
 * This is the human-readable fallback for when online payments aren't
 * wired up yet (Phase 12 Part 1) AND the permanent backup for any
 * invoice whose client prefers to pay a way other than card.
 */
export default async function PaymentMethodsPage() {
  const membership = await requireMembership(["owner", "admin"]);
  const supabase = await createSupabaseServerClient();

  const { data: org } = await supabase
    .from("organizations")
    .select("default_payment_instructions")
    .eq("id", membership.organization_id)
    .maybeSingle();

  return (
    <PageShell
      title="Payment instructions"
      description="What your clients see on the public invoice page when they ask 'how do I pay?'"
      actions={
        <Link
          href="/app/settings"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      }
    >
      <div className="max-w-2xl space-y-4">
        <div className="rounded-lg border border-border bg-muted/20 p-4 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">
            This text is public.
          </p>
          <p className="mt-1">
            Anyone with an invoice link sees it. Don&apos;t paste
            passwords, account numbers you&apos;d rather not share, or
            anything you wouldn&apos;t email a stranger.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-6">
          <PaymentMethodsForm
            defaultInstructions={org?.default_payment_instructions ?? ""}
          />
        </div>
      </div>
    </PageShell>
  );
}
