import { requireMembership } from "@/lib/auth";
import { FieldHeader } from "@/components/field-shell";
import { ChatView } from "@/components/chat/chat-view";
import {
  fetchChatMessages,
  fetchChatThreads,
  fetchTeammates,
} from "@/lib/chat-data";

export const metadata = { title: "Chat" };

type SearchParams = { thread?: string };

export default async function FieldChatPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const membership = await requireMembership();
  const params = await searchParams;

  let threads: Awaited<ReturnType<typeof fetchChatThreads>> = [];
  let teammates: Awaited<ReturnType<typeof fetchTeammates>> = [];

  try {
    [threads, teammates] = await Promise.all([
      fetchChatThreads(membership),
      fetchTeammates(membership),
    ]);
  } catch (err) {
    console.error("[chat] Failed to load threads/teammates:", err);
  }

  const requested = params.thread ?? null;
  const activeThread = requested
    ? threads.find((t) => t.id === requested) ?? null
    : null;

  let initialMessages: Awaited<ReturnType<typeof fetchChatMessages>> = [];
  if (activeThread) {
    try {
      initialMessages = await fetchChatMessages(activeThread.id);
    } catch (err) {
      console.error("[chat] Failed to load messages:", err);
    }
  }

  return (
    <>
      <FieldHeader
        title="Chat"
        description="DM your manager or chime in on #general."
      />
      <ChatView
        threads={threads}
        teammates={teammates}
        activeThreadId={activeThread?.id ?? null}
        initialMessages={initialMessages}
        currentMembershipId={membership.id}
        basePath="/field/chat"
        variant="mobile"
      />
    </>
  );
}
