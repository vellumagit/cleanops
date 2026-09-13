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

-- (The webhooks table needs nothing here: its url column has carried
-- CHECK (url LIKE 'https://%') since 20260418010000. Dispatch re-checks
-- the address itself now; see src/lib/url-safety.ts.)

notify pgrst, 'reload schema';
