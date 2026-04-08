import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { FieldShell } from "@/components/field-shell";

export default async function FieldLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Field app is open to every active member, including owners/admins so
  // they can dogfood it. RLS still scopes data to their org.
  const membership = await requireMembership();
  const supabase = await createSupabaseServerClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", membership.profile_id)
    .maybeSingle();

  return (
    <FieldShell
      organizationName={membership.organization_name}
      userName={profile?.full_name ?? null}
    >
      {children}
    </FieldShell>
  );
}
