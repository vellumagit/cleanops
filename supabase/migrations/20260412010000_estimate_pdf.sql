-- =============================================================================
-- Migration: Add PDF attachment support to estimates
-- =============================================================================

alter table public.estimates
  add column if not exists pdf_url text;

comment on column public.estimates.pdf_url is
  'Public URL of an uploaded PDF estimate file in org-assets storage';
