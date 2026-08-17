-- =============================================================================
-- Manager capabilities — what THIS manager does, not what managers do
-- supabase/migrations/20260819010000_manager_capabilities.sql
-- =============================================================================
-- "Manager" is one rung on a ladder, and a real team is not a ladder. Olha is
-- not blocked by anything; the opposite — she can see every number in the
-- business, and most of them are none of her job. Svitlana wants to say what
-- each manager actually does: this one schedules, that one runs timesheets,
-- neither of them needs to read invoices.
--
-- So capabilities hang off the MEMBERSHIP, not the role:
--
--   owner, admin   every capability, always. Not togglable — an owner who
--                  can lock themselves out of their own books is a support
--                  ticket waiting to happen.
--   manager        exactly the capabilities switched on for them.
--   employee       none of these. The field app is their surface and it is
--                  gated separately.
--
-- NULL means "everything", which is what every existing manager has today —
-- so this migration changes nobody's access on the day it runs. A manager only
-- becomes restricted when somebody deliberately unticks a box for them.
-- Storing the absence of a decision as NULL, rather than backfilling all-true,
-- keeps "never configured" distinguishable from "considered and granted".
--
-- Shape: {"scheduling": true, "invoicing": false, ...}. JSONB rather than
-- columns because this list will grow, and adding a key should not mean a
-- migration each time.
--
-- SCOPE, stated plainly: this gates the APPLICATION — pages, actions, the
-- sidebar. It is not a second RLS layer. Row-level security still answers
-- "which ORG's rows can this person read", which is the boundary that
-- protects tenants from each other. Turning off `invoicing` for a manager
-- removes it from their app; it does not stop someone technical from
-- querying the API with their own token. For deciding who sees what inside
-- one trusted team, that is the right altitude.

alter table public.memberships
  add column if not exists capabilities jsonb;

comment on column public.memberships.capabilities is
  'Per-manager capability switches, e.g. {"scheduling":true,"invoicing":false}. NULL = unrestricted (every existing manager, and the default for new ones). Owners/admins ignore this and always have everything; employees never do. Application-layer gating: pages, server actions and navigation — NOT a replacement for RLS, which still enforces org isolation.';

notify pgrst, 'reload schema';
