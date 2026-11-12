-- Estimate PDFs get a private bucket (2026-11-11).
--
-- An uploaded estimate PDF used to go into the public `org-assets` bucket
-- (the one that serves logos), readable by anyone with the URL, forever.
-- From now on it goes here, private: no policies, so only the server's
-- service role reads or writes it, and people get signed links that expire
-- (lib/estimate-pdf-storage.ts).
--
-- RUN THIS BEFORE THE PUSH: the new code uploads into this bucket, so an
-- upload made after the push and before this would fail.
--
-- On 2026-11-11 no estimate had a PDF attached, so nothing needs moving.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'estimate-pdfs',
  'estimate-pdfs',
  false,
  10485760, -- 10 MB, the limit the upload checks
  array['application/pdf']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
