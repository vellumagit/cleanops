import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { maybeDecryptField } from "@/lib/field-encryption";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { PaymentMethodsForm } from "./payment-methods-form";
import { TipInstructionsForm } from "./tip-instructions-form";
import { TippingForm } from "@/app/app/settings/invoicing/tipping-form";
import { parseTippingSettings } from "@/lib/tip-split";

export const metadata = { title: "Getting paid" };

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

  // Decrypt for the edit form so the owner sees their existing text
  // (legacy plaintext rows pass through unchanged).
  const plainInstructions = maybeDecryptField(
    org?.default_payment_instructions ?? null,
  );

  // Separate query, and wrapped. tipping_settings is newer than the generated
  // types, and PostgREST fails the WHOLE select if one column is unknown —
  // folding it in above would blank the payment instructions on a schema-cache
  // hiccup, which is the exact failure this page exists to avoid.
  const tipping = await (async () => {
    try {
      const { data } = (await supabase
        .from("organizations")
        .select("tipping_settings")
        .eq("id", membership.organization_id)
        .maybeSingle()) as unknown as {
        data: { tipping_settings: unknown } | null;
      };
      return parseTippingSettings(data?.tipping_settings);
    } catch {
      return parseTippingSettings(null);
    }
  })();

  // Its own query for the same reason: the card-tip form only needs to know
  // whether Stripe can take a tip, and a failure here must not blank the
  // tip settings above. Read the way Settings → Invoicing read it when the
  // form lived there.
  const stripeConnected = await (async () => {
    try {
      const { data } = (await createSupabaseAdminClient()
        .from("organizations")
        .select("stripe_account_id, stripe_charges_enabled")
        .eq("id", membership.organization_id)
        .maybeSingle()) as unknown as {
        data: { stripe_account_id: string | null; stripe_charges_enabled: boolean | null } | null;
      };
      return Boolean(data?.stripe_account_id && data?.stripe_charges_enabled);
    } catch {
      return false;
    }
  })();

  return (
    <PageShell
      title="Getting paid"
      description="How clients pay you: card payments, the instructions on every invoice, and tips."
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
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-sm font-semibold">Card payments</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Clients get a Pay button on every invoice once Stripe or Square is
            connected. Connecting, payouts and refunds are handled on{" "}
            <Link href="/app/settings/integrations" className="underline underline-offset-2">
              Integrations
            </Link>
            .
          </p>
        </div>

        <h2 className="pt-2 text-sm font-semibold">Payment instructions</h2>
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
            defaultInstructions={plainInstructions ?? ""}
          />
        </div>

        {/* Tipping wording sits BENEATH payment instructions because that is
            what it is — more text a client reads while working out how to pay.
            The card checkout can offer buttons; a bank transfer has nothing to
            attach a button to, so words are the only lever that channel has,
            and it is the channel nearly every payment here arrives through. */}
        <h2 className="pt-2 text-sm font-semibold">Tipping</h2>
        {/* Both tip settings in one place. Card tips lived on Settings →
            Invoicing until 2026-11-21, a page away from the wording below
            that shares their column. */}
        <div className="rounded-lg border border-border bg-card p-6">
          <h3 className="text-sm font-medium">Tips on card payments</h3>
          <p className="mb-4 mt-0.5 text-xs text-muted-foreground">
            Stripe has no tipping for invoice links &mdash; its built-in
            tipping is for in-person card readers &mdash; so this is ours.
            When it&rsquo;s on, clients paying by card can add a tip, and we
            record who it&rsquo;s owed to so you can pay it out. Off by
            default.
          </p>
          <TippingForm
            enabled={tipping.enabled}
            presets={tipping.presets}
            stripeConnected={stripeConnected}
          />
        </div>
        <div className="rounded-lg border border-border bg-card p-6">
          <h3 className="text-sm font-medium">Tip wording on the invoice</h3>
          <p className="mb-4 mt-0.5 text-xs text-muted-foreground">
            Shown under your payment instructions on the invoice. Clients
            paying by card get tip buttons at checkout; anyone paying by
            e-transfer or cash only has what you write here. Leave it blank to
            say nothing.
          </p>
          <TipInstructionsForm
            defaultInstructions={tipping.instructions ?? ""}
            tippingEnabled={tipping.enabled}
          />
        </div>
      </div>
    </PageShell>
  );
}
