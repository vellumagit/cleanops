import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { centsToDollarString } from "@/lib/validators/common";
import { PackageForm } from "../../package-form";
import { DeletePackageForm } from "./delete-form";

export const metadata = { title: "Edit package" };

export default async function EditPackagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireMembership(["owner", "admin"]);
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: pkg, error } = await supabase
    .from("packages")
    .select("id, name, description, duration_minutes, price_cents, is_active, included")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!pkg) notFound();

  const includedText = Array.isArray(pkg.included)
    ? (pkg.included as string[]).join("\n")
    : "";

  return (
    <PageShell title="Edit package" description={pkg.name}>
      <div className="max-w-2xl space-y-6">
        <div className="rounded-lg border border-border bg-card p-6">
          <PackageForm
            mode="edit"
            id={pkg.id}
            defaults={{
              name: pkg.name,
              description: pkg.description,
              duration_minutes: pkg.duration_minutes,
              price_dollars: centsToDollarString(pkg.price_cents),
              is_active: pkg.is_active,
              included_text: includedText,
            }}
          />
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6">
          <h2 className="text-sm font-semibold text-destructive">Danger zone</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Deleting a package will fail if any bookings reference it. Reassign
            those bookings first.
          </p>
          <div className="mt-4">
            <DeletePackageForm id={pkg.id} />
          </div>
        </div>
      </div>
    </PageShell>
  );
}
