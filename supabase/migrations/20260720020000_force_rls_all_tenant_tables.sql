-- =============================================================================
-- Defense-in-depth: FORCE row level security on every RLS-enabled table
-- =============================================================================
-- RLS was `enable`d on ~76 tables but `force`d on only ~31. FORCE additionally
-- applies RLS to the table-owner role — the documented "safety net" the initial
-- auth migration set on organizations/profiles/memberships/invitations, but
-- which was never extended to the tables added later (payroll, membership_admin_data,
-- invoice_payments, integration_connections, job_photos, …).
--
-- No runtime impact in the current architecture (the app connects as
-- authenticated/anon — always subject to RLS — or service_role, which has
-- BYPASSRLS and is unaffected by FORCE). This closes the gap against a future
-- SECURITY DEFINER function or a query accidentally run as the table owner.
--
-- Dynamic + idempotent: forces every table that is RLS-enabled but not yet
-- forced, so there's no hardcoded list to drift and re-running is a no-op.
-- =============================================================================

do $$
declare
  r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relrowsecurity = true        -- RLS enabled
      and c.relforcerowsecurity = false  -- but not forced
  loop
    execute format('alter table public.%I force row level security', r.relname);
    raise notice 'forced RLS on public.%', r.relname;
  end loop;
end $$;
