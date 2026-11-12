-- The property-level checklist, dropped (decided 2026-11-11).
--
-- client_properties.default_checklist_template_id was added with properties
-- (20260810010000) to override the client's checklist at one property. The
-- form saved it; nothing ever applied it to a job. Jobs get the client's
-- default (the trigger in 20261024010000 reads clients, not properties). On
-- 2026-11-11 none of production's 83 properties had one set.
--
-- RUN THIS AFTER THE PUSH, not before: the code live until then still reads
-- and writes the column.
--
-- Refuses to run if a property has a checklist set since it was counted, so
-- nobody's choice is thrown away without a look.

do $$
begin
  if exists (
    select 1 from public.client_properties
    where default_checklist_template_id is not null
  ) then
    raise exception 'A property has a checklist set; look at it before dropping the column.';
  end if;
end $$;

alter table public.client_properties
  drop column if exists default_checklist_template_id;
