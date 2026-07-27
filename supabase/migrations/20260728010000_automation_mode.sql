-- =============================================================================
-- Automation routing mode: "all clients" vs "per client"
-- =============================================================================
-- Route A (all_clients, default): client-facing automations you enable apply
-- to every client; per-client settings act as exceptions. What shipped so far.
--
-- Route B (per_client): client-facing automations are managed client by
-- client (a manager inside Settings → Automations, linked from each client
-- profile). Nothing client-facing sends for a client until it's enabled on
-- that client. The org-level client-facing toggles are ignored in this mode —
-- that's the point: no redundant second authority. Team/back-office/
-- housekeeping automations remain org-level in BOTH modes.
--
-- Every existing org keeps today's behaviour (default 'all_clients').
-- =============================================================================

alter table public.organizations
  add column if not exists automation_mode text not null default 'all_clients';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'organizations_automation_mode_chk'
  ) then
    alter table public.organizations
      add constraint organizations_automation_mode_chk
      check (automation_mode in ('all_clients', 'per_client'));
  end if;
end $$;

comment on column public.organizations.automation_mode is
  'all_clients: enabled client-facing automations reach everyone (per-client exceptions). per_client: client-facing sends are configured per client; org client-facing toggles are ignored.';
