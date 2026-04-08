import { requireMembership } from "@/lib/auth";
import { PageShell } from "@/components/page-shell";
import { ChatView } from "@/components/chat/chat-view";
import {
  fetchChatMessages,
  fetchChatThreads,
  fetchTeammates,
} from "@/lib/chat-data";

export const metadata = { title: "Chat" };

type SearchParams = { thread?: string };

export default async function AppChatPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const membership = await requireMembership();
  const params = await searchParams;

  const [threads, teammates] = await Promise.all([
    fetchChatThreads(membership),
    fetchTeammates(membership),
  ]);

  const requested = params.thread ?? null;
  const activeThread =
    (requested && threads.find((t) => t.id === requested)) ||
    threads[0] ||
    null;

  const initialMessages = activeThread
    ? await fetchChatMessages(activeThread.id)
    : [];

  return (
    <PageShell
      title="Chat"
      description="Realtime DMs and the org-wide #general thread."
    >
      <ChatView
        threads={threads}
        teammates={teammates}
        activeThreadId={activeThread?.id ?? null}
        initialMessages={initialMessages}
        currentMembershipId={membership.id}
        basePath="/app/chat"
        variant="desktop"
      />
    </PageShell>
  );
}
