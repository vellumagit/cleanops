import { PageShell, ComingSoon } from "@/components/page-shell";

export const metadata = { title: "Chat" };

export default function ChatPage() {
  return (
    <PageShell
      title="Chat"
      description="Real-time messaging with your team and field crew."
    >
      <ComingSoon phase="Phase 8" />
    </PageShell>
  );
}
