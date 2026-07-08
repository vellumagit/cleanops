-- Aggregate helper for the SMS monthly allotment gate.
--
-- sendOrgSms needs the total billable segments an org has sent this period on
-- every send. Summing in the app meant fetching every 'sent' row each time;
-- this pushes the SUM into Postgres (indexed on organization_id/direction/
-- created_at) so the hot path reads one integer.

create or replace function public.sms_month_segments(
  p_org uuid,
  p_since timestamptz
)
returns integer
language sql
stable
as $$
  select coalesce(sum(segments), 0)::int
  from public.sms_messages
  where organization_id = p_org
    and direction = 'outbound'
    and status = 'sent'
    and created_at >= p_since;
$$;

notify pgrst, 'reload schema';
