import { PageShell, ComingSoon } from "@/components/page-shell";

export const metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <PageShell
      title="Settings"
      description="Organization, members, billing, and integrations."
    >
      <ComingSoon phase="Phase 4" />
    </PageShell>
  );
}
