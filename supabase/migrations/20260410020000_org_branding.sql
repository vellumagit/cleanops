-- -----------------------------------------------------------------------------
-- Organization branding
--
-- Stores the org's visual identity: logo, accent colour, and optional
-- secondary colour. These are surfaced on public-facing pages (invoices,
-- claim links) and optionally on the ops console sidebar.
--
-- logo_url points to a Supabase Storage object in the `org-assets` bucket.
-- Colours are stored as 6-char hex (no #) and validated with a regex.
-- -----------------------------------------------------------------------------

-- Storage bucket for org assets (logos, etc.)
insert into storage.buckets (id, name, public)
values ('org-assets', 'org-assets', true)
on conflict (id) do nothing;

-- RLS: members of the org can upload/read/delete their own files
-- Files are stored under a folder named after the org id: {org_id}/logo.png
create policy "Org members can read own assets"
  on storage.objects for select
  using (
    bucket_id = 'org-assets'
    and (storage.foldername(name))[1]::uuid in (
      select organization_id from public.memberships
      where profile_id = auth.uid() and status = 'active'
    )
  );

create policy "Admins can upload org assets"
  on storage.objects for insert
  with check (
    bucket_id = 'org-assets'
    and (storage.foldername(name))[1]::uuid in (
      select organization_id from public.memberships
      where profile_id = auth.uid()
        and status = 'active'
        and role in ('owner', 'admin')
    )
  );

create policy "Admins can update org assets"
  on storage.objects for update
  using (
    bucket_id = 'org-assets'
    and (storage.foldername(name))[1]::uuid in (
      select organization_id from public.memberships
      where profile_id = auth.uid()
        and status = 'active'
        and role in ('owner', 'admin')
    )
  );

create policy "Admins can delete org assets"
  on storage.objects for delete
  using (
    bucket_id = 'org-assets'
    and (storage.foldername(name))[1]::uuid in (
      select organization_id from public.memberships
      where profile_id = auth.uid()
        and status = 'active'
        and role in ('owner', 'admin')
    )
  );

-- Branding columns on organizations
alter table public.organizations
  add column if not exists logo_url text,
  add column if not exists brand_color text
    check (brand_color is null or brand_color ~ '^[0-9a-fA-F]{6}$');

comment on column public.organizations.logo_url is
  'Public URL of the org logo stored in the org-assets bucket.';
comment on column public.organizations.brand_color is
  'Primary brand colour as 6-char hex (no #). Used on invoices, public pages, and optionally the sidebar.';
