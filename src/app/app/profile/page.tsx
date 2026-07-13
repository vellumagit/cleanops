import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { YourProfileForm } from "./your-profile-form";

export const metadata = { title: "Your profile" };

export default async function YourProfilePage() {
  const membership = await requireMembership(["owner", "admin", "manager"]);
  const supabase = await createSupabaseServerClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, phone")
    .eq("id", membership.profile_id)
    .maybeSingle();

  const p = profile as { full_name: string | null; phone: string | null } | null;

  return (
    <PageShell
      title="Your profile"
      description="Your name and contact info — how you appear across Sollos."
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
      <YourProfileForm
        defaults={{ full_name: p?.full_name ?? "", phone: p?.phone ?? "" }}
      />
    </PageShell>
  );
}
