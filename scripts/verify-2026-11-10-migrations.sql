-- Read-only. Paste into the Supabase SQL editor. One row per migration from
-- 2026-11-10; every row should say OK. Changes nothing.
select check_name, verdict from (
  select 1 as n, '010000 internal functions closed to the public key' as check_name,
    case when not has_function_privilege('anon', 'public.bump_org_email_counter(uuid, date)', 'execute')
          and not has_function_privilege('anon', 'public.booking_shares_hours(boolean, uuid)', 'execute')
          and not has_function_privilege('authenticated', 'public.booking_member_windows(uuid, uuid, timestamptz, integer, jsonb, uuid, boolean, uuid)', 'execute')
         then 'OK' else 'NOT RUN' end as verdict
  union all
  select 2, '020000 divide hours ignores the automations switch',
    case when pg_get_functiondef('public.booking_shares_hours(boolean, uuid)'::regprocedure) not like '%automations_enabled%'
         then 'OK' else 'NOT RUN' end
  union all
  select 3, '030000 shifts and bonuses kept when a member is deleted',
    case when (select confdeltype from pg_constraint where conname = 'time_entries_employee_id_fkey') = 'a'
          and (select confdeltype from pg_constraint where conname = 'bonuses_employee_id_fkey') = 'a'
         then 'OK' else 'NOT RUN' end
  union all
  select 4, '040000 webhook secrets for owners and admins only',
    case when not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'webhooks' and policyname = 'org_members_read_webhooks')
          and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'integration_events'
                      and policyname = 'admins read integration_events' and qual like '%organization_id IS NOT NULL%')
         then 'OK' else 'NOT RUN' end
  union all
  select 5, '050000 review links stored as hashes',
    case when not exists (select 1 from public.bookings where review_token is not null and review_token not like 'sha256:%')
          and not exists (select 1 from public.invoices where review_token is not null and review_token not like 'sha256:%')
         then 'OK' else 'NOT RUN' end
  union all
  select 6, '060000 invoices, estimates, contracts readable by the office only',
    case when (select count(*) from pg_policies where schemaname = 'public'
               and policyname in ('office reads invoices', 'office reads estimates', 'office reads contracts')) = 3
          and not exists (select 1 from pg_policies where schemaname = 'public'
               and policyname in ('members read invoices', 'members read estimates', 'members read contracts'))
         then 'OK' else 'NOT RUN' end
) checks order by n;
