import { FieldHeader } from "@/components/field-shell";

export const metadata = { title: "Chat" };

export default function FieldChatPage() {
  return (
    <>
      <FieldHeader
        title="Chat"
        description="Realtime DMs and an org-wide #general thread land in Phase 8."
      />
      <div className="rounded-lg border border-dashed border-border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
        Chat is wired up in Phase 8. Until then, ping your manager the
        old-fashioned way.
      </div>
    </>
  );
}
