/**
 * Add what the server has that the screen doesn't, and leave the rest alone.
 * Returns the same array when there is nothing new, so nothing re-renders.
 * A message of ours still marked as sending is not doubled: the server copy
 * takes its place (same sender, text and photo count), keeping the previews
 * already on screen.
 */
export function mergeServerMessages<T extends {
  id: string;
  sender_id: string | null;
  body: string;
  created_at: string;
  attachments: unknown[];
  status?: string;
}>(shown: T[], server: T[]): T[] {
  const ids = new Set(shown.map((m) => m.id));
  const fresh = server.filter((m) => !ids.has(m.id));
  if (fresh.length === 0) return shown;
  const next = shown.slice();
  const added: T[] = [];
  for (const m of fresh) {
    const mine = next.findIndex(
      (x) =>
        x.status === "sending" &&
        x.sender_id === m.sender_id &&
        x.body === m.body &&
        x.attachments.length === m.attachments.length,
    );
    if (mine >= 0) next[mine] = { ...m, attachments: next[mine].attachments };
    else added.push(m);
  }
  if (added.length === 0) return next;
  return [...next, ...added].sort((a, b) => a.created_at.localeCompare(b.created_at));
}
