-- ============================================================
-- Storage buckets state what they accept; a webhook target is https
-- ============================================================
--
-- September audit, round two. Three buckets had no size or type limit at
-- all: org-assets (PUBLIC — every object readable by anyone with the URL),
-- employee-documents and subcontractor-bills (private, but a signed URL
-- served whatever content-type the uploader claimed). The app now checks
-- bytes on every writer; the bucket is the backstop for any writer that
-- forgets, including one that reaches storage past the app.
--
-- Sizes match the largest app-side cap on each bucket (10 MB estimate PDFs
-- in org-assets; 15 MB documents and bills).

update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array[
      'image/png', 'image/jpeg', 'image/webp', 'image/gif',
      'application/pdf'
    ]
where id = 'org-assets';

update storage.buckets
set file_size_limit = 15728640,
    allowed_mime_types = array[
      'image/png', 'image/jpeg', 'image/webp', 'image/gif',
      'application/pdf', 'text/plain', 'text/csv',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]
where id in ('employee-documents', 'subcontractor-bills');

-- The webhooks policy is FOR ALL for owners/admins, so a target_url can be
-- written straight into the table, past the server action's URL check.
-- Dispatch re-checks the URL now; the database refuses the plain-http case
-- outright. NOT VALID: existing rows are not re-examined, new and updated
-- ones are.
alter table public.webhooks
  drop constraint if exists webhooks_target_url_https;
alter table public.webhooks
  add constraint webhooks_target_url_https
  check (target_url ~* '^https://') not valid;

notify pgrst, 'reload schema';
