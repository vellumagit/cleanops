-- Read-only. Shows exactly what the access rules found only in production allow.
-- Run in the Supabase SQL editor and paste the result back.
select tablename,
       policyname,
       cmd,
       permissive,
       roles::text as roles,
       qual       as who_it_applies_to,
       with_check as what_the_new_row_must_satisfy
  from pg_policies
 where schemaname = 'public'
   and policyname in (
     'Members can update their org bookings',
     'Members can update their org estimates',
     'Members can update their org invoices',
     'admins or assignee update bookings',
     'employees can insert own pto requests'
   )
 order by tablename, policyname;
