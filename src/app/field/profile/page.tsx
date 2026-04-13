import Link from "next/link";
import { ChevronRight, GraduationCap } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { FieldHeader } from "@/components/field-shell";
import { ProfileForm } from "./profile-form";
import { PushToggle } from "@/components/push-prompt";

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

      {/* Notifications */}
      <div className="mt-5 rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 text-sm font-semibold">Push notifications</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Get alerts on this device for new jobs, messages, and schedule changes — even when the app is in the background.
        </p>
        <PushToggle
          membershipId={membership.id}
          organizationId={membership.organization_id}
        />
      </div>

      {/* Quick links */}
      <div className="mt-5 space-y-2">
        <Link
          href="/field/training"
          className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors active:bg-muted"
        >
          <GraduationCap className="h-5 w-5 text-muted-foreground" />
          <span className="flex-1 text-[15px] font-medium">Training modules</span>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </Link>
      </div>
    </>
  );
}
