import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { FieldShell } from "@/components/field-shell";
import { BrandProvider } from "@/components/brand-provider";
import { PushPrompt } from "@/components/push-prompt";
import { isFeedVisible } from "@/lib/feed-visibility";

export default async function FieldLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Field app is open to every active member, including owners/admins so
  // they can dogfood it. RLS still scopes data to their org.
  const membership = await requireMembership();
  const supabase = await createSupabaseServerClient();

  // Chat unread powers a nav badge only — it must NEVER block the field
  // shell from rendering. Race it against a short timeout and fall back to
  // 0 so a slow/hanging RPC can't leave the whole app stuck on the loader.
  const chatUnreadPromise: Promise<number> = (async () => {
    try {
      const res = (await Promise.race([
        supabase.rpc("chat_unread_total" as never, {
          p_org_id: membership.organization_id,
        } as never),
        new Promise((resolve) =>
          setTimeout(() => resolve({ data: 0 }), 2500),
        ),
      ])) as { data: number | null };
      return Number(res?.data ?? 0);
    } catch {
      return 0;
    }
  })();

  const [{ data: profile }, { data: org }, feedEnabled, chatUnread] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("full_name")
        .eq("id", membership.profile_id)
        .maybeSingle(),
      supabase
        .from("organizations")
        .select("logo_url, brand_color")
        .eq("id", membership.organization_id)
        .maybeSingle() as unknown as {
        data: { logo_url: string | null; brand_color: string | null } | null;
      },
      isFeedVisible(membership.organization_id),
      chatUnreadPromise,
    ]);

  return (
    <BrandProvider brandColor={org?.brand_color ?? null}>
      <FieldShell
        organizationName={membership.organization_name}
        userName={profile?.full_name ?? null}
        logoUrl={org?.logo_url ?? null}
        brandColor={org?.brand_color ?? null}
        role={membership.role}
        feedEnabled={feedEnabled}
        chatUnread={chatUnread}
      >
        <PushPrompt
          membershipId={membership.id}
          organizationId={membership.organization_id}
        />
        {children}
      </FieldShell>
    </BrandProvider>
  );
}
