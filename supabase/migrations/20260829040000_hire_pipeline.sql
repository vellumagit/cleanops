-- The hire pipeline: applicant → invite → membership, nothing retyped.
--
-- Two small columns complete two half-built connections:
--
-- 1. The invite form has ALWAYS asked for a pay rate — validated it,
--    audit-logged it, then dropped it. The membership appeared with no
--    wage and payroll priced the new hire's hours at $0 until someone
--    remembered to set it. The invitation now carries the wage and the
--    join flow applies it the moment the membership exists.
--
-- 2. Training modules can mark themselves as onboarding content:
--    assign_on_join modules are auto-assigned to every new membership at
--    accept time — the "assign the onboarding training" step of Brian's
--    hiring procedure, done by the system instead of memory.

alter table public.invitations
  add column if not exists pay_rate_cents integer
    check (pay_rate_cents is null or (pay_rate_cents >= 0 and pay_rate_cents <= 50000000));

comment on column public.invitations.pay_rate_cents is
  'Hourly wage in cents chosen when the invite was sent; applied to the membership when the invite is accepted. NULL = set it later.';

alter table public.training_modules
  add column if not exists assign_on_join boolean not null default false;

comment on column public.training_modules.assign_on_join is
  'Onboarding content: auto-assigned to every new membership the moment it is created (invite accept / hire flow).';
