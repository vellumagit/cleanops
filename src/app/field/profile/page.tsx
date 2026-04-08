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

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-lg font-semibold">
            {(profile?.full_name ?? "U").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              {profile?.full_name ?? "Unnamed crew"}
            </div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
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

      <p className="mt-3 text-center text-[11px] text-muted-foreground">
        Avatar uploads land in a follow-up patch.
      </p>
    </>
  );
}
