-- ============================================================
-- Photos in chat
-- ============================================================
--
-- Brian's 2026-11-04 ask: cleaners and managers snap or pick a photo and
-- send it in chat, the way they already do in their phone's messenger.
-- chat_messages has carried an `attachments jsonb` column since April with
-- nothing writing it; it holds the photos now, as
--   [{ "path": "<org>/<thread>/<uuid>.jpg", "mime": "image/jpeg", "size": 123 }]
--
-- A photo may be sent with no words, so the body check loosens from
-- "1 to 10,000 characters" to "up to 10,000, and not empty unless there is
-- at least one attachment". Reads and writes of the rows keep the existing
-- chat policies (thread members only).
--
-- Files go from the phone straight to storage on a one-time signed upload
-- URL made by a server action that has checked the sender is in the thread
-- (same shape as client-media, migration 20261103010000). The bucket is
-- private; the server signs read URLs for thread members. No storage
-- policies: nothing reads or writes the bucket except the service role.

alter table public.chat_messages
  drop constraint if exists chat_messages_body_check;

alter table public.chat_messages
  add constraint chat_messages_body_check
  check (
    length(body) <= 10000
    and (length(body) >= 1 or jsonb_array_length(attachments) > 0)
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-media',
  'chat-media',
  false,
  20971520, -- 20 MB; photos are shrunk on the phone first and land near 1 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
