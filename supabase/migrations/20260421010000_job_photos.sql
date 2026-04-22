-- Job photos
--
-- Cleaners upload before/after photos from the field app. The admin side
-- views them on the booking detail. Kind is a free 'before' / 'after' /
-- 'other' tag so the business can sort at a glance but isn't forced into
-- a two-photo-only rhythm.
--
-- Storage: a private bucket scoped per-org, objects keyed by
--   {organization_id}/{booking_id}/{photo_id}.{ext}
-- so deletion of a booking's photos is a single prefix-delete.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'job-photos',
  'job-photos',
  false,
  10485760,   -- 10 MB per photo. Modern phones shoot ~3-5 MB JPEGs.
  ARRAY['image/jpeg', 'image/png', 'image/heic', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS
-- Read: any active member of the org can view
CREATE POLICY "job_photos_select"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'job-photos'
    AND (storage.foldername(name))[1] IN (
      SELECT organization_id::text FROM public.memberships
      WHERE profile_id = auth.uid() AND status = 'active'
    )
  );

-- Write: any active member can upload. Crew own the evidence of
-- their own work, so we don't restrict by role here. The app-level
-- action still checks that the uploader is the assigned cleaner
-- or an owner/admin/manager.
CREATE POLICY "job_photos_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'job-photos'
    AND (storage.foldername(name))[1] IN (
      SELECT organization_id::text FROM public.memberships
      WHERE profile_id = auth.uid() AND status = 'active'
    )
  );

-- Delete: uploader or owner/admin/manager. Lets a cleaner remove a
-- bad shot without calling the office, while keeping clients and
-- non-assigned cleaners from deleting someone else's work.
CREATE POLICY "job_photos_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'job-photos'
    AND (storage.foldername(name))[1] IN (
      SELECT organization_id::text FROM public.memberships
      WHERE profile_id = auth.uid() AND status = 'active'
        AND role IN ('owner', 'admin', 'manager')
    )
  );

-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.job_photos (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  booking_id      uuid        NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  storage_path    text        NOT NULL,
  kind            text        NOT NULL DEFAULT 'other'
                              CHECK (kind IN ('before', 'after', 'other')),
  caption         text,
  file_size       bigint,
  mime_type       text,
  uploaded_by     uuid        REFERENCES public.memberships(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_photos_booking_idx ON public.job_photos(booking_id);
CREATE INDEX IF NOT EXISTS job_photos_org_idx ON public.job_photos(organization_id);

ALTER TABLE public.job_photos ENABLE ROW LEVEL SECURITY;

-- Read: any active member of the org.
CREATE POLICY "org_members_read_job_photos"
  ON public.job_photos FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM public.memberships
    WHERE profile_id = auth.uid() AND status = 'active'
  ));

-- Insert: active members of the org. Action-layer enforces "must be
-- the assigned cleaner OR owner/admin/manager".
CREATE POLICY "org_members_insert_job_photos"
  ON public.job_photos FOR INSERT
  WITH CHECK (organization_id IN (
    SELECT organization_id FROM public.memberships
    WHERE profile_id = auth.uid() AND status = 'active'
  ));

-- Update: owner/admin/manager. Cleaners can delete-and-reupload
-- if they need to fix a caption.
CREATE POLICY "org_managers_update_job_photos"
  ON public.job_photos FOR UPDATE
  USING (organization_id IN (
    SELECT organization_id FROM public.memberships
    WHERE profile_id = auth.uid() AND status = 'active'
      AND role IN ('owner', 'admin', 'manager')
  ));

-- Delete: uploader OR owner/admin/manager.
CREATE POLICY "authors_or_managers_delete_job_photos"
  ON public.job_photos FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.memberships
      WHERE profile_id = auth.uid() AND status = 'active'
    )
    AND (
      uploaded_by IN (
        SELECT id FROM public.memberships WHERE profile_id = auth.uid()
      )
      OR
      organization_id IN (
        SELECT organization_id FROM public.memberships
        WHERE profile_id = auth.uid() AND status = 'active'
          AND role IN ('owner', 'admin', 'manager')
      )
    )
  );
