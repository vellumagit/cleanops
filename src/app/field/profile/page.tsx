import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { FieldHeader } from "@/components/field-shell";
import { ProfileForm } from "./profile-form";

export const metadata = { title: "Profile" };

export default async function FieldProfilePage() {
  const membership = await requireMembership();
  const supabase = await createSupabaseServerClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, phone")
    .eq("id", membership.profile_id)
    .maybeSingle();

  return (
    <>
      <FieldHeader
        title="Profile"
        description="Keep your contact info up to date so your team can reach you."
      />

      <div className="rounded-xl border border-border bg-card p-5">
        <div className="mb-5 flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-xl font-bold">
            {(profile?.full_name ?? "U").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="truncate text-lg font-bold">
              {profile?.full_name ?? "Unnamed crew"}
            </div>
            <div className="text-sm uppercase tracking-wide text-muted-foreground">
              {membership.role} · {membership.organization_name}
            </div>
          </div>
        </div>

        <ProfileForm
          defaults={{
            full_name: profile?.full_name ?? "",
            phone: profile?.phone ?? "",
          }}
        />
      </div>
    </>
  );
}
