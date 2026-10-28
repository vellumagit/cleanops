# Map of RLS-scoped readers that decide about other people — cleanops (read-only inventory, 2026-10-28)

Clients: `createSupabaseServerClient()` (src/lib/supabase/server.ts, anon key + user JWT, RLS applies) = **user**; `createSupabaseAdminClient()` (src/lib/supabase/admin.ts, service role, bypasses RLS) = **admin**. Both wrapped by `guardQueries` (src/lib/supabase/query-guard.ts): a query *error* is logged loudly, but a *policy-filtered* result is indistinguishable from "no rows" — that is the bug class this map is about.

Role model: `membership_role` enum is owner | admin | manager | employee (20260407044907 + 20260411030000). **Subcontractors are not a role** — `memberships.engagement = 'subcontractor'` (20260808010000) is orthogonal to `role`; a roster subcontractor is role=employee for every policy below, so "employee" in this map means cleaner and subcontractor alike.

---

## Step 1 — RLS policies, per table (all migrations read; latest definition wins)

### time_entries
Migrations: 20260407230757 (orig), 20260411030001 (adds manager), 20260422010000 (manager write policies), 20260829030000 (employee update narrowed to open+unclaimed), 20260913030000 S1 (insert trigger).

| op | owner/admin/manager | employee (incl. subcontractor) | client |
|---|---|---|---|
| SELECT | all rows in org (`current_user_has_role`) | **only rows where `employee_id` ∈ own active memberships** ("members read own time_entries or admins all") | none |
| INSERT | any row in org ("managers_insert_time_entries") | own rows only (org ∈ mine AND employee_id = mine). Trigger `time_entries_employee_insert_guard` (S1) then **rewrites** non-manager inserts: `clock_in_at := now()`, `clock_out_at := null`, run ids null, rate/engagement snapshots from the membership | none |
| UPDATE | any row in org (two policies) | own row only while `clock_out_at IS NULL` and `payroll_run_id`/`subcontractor_run_id` null; WITH CHECK keeps run ids null | none |
| DELETE | owner/admin/manager | none | none |

Consequence: through a cleaner's session, a crew's time_entries read is **always partial** (her own rows only). Through a manager's session it is complete.

### booking_assignees
Migration: 20260422020000 only (never widened).

| op | owner/admin/manager | employee | client |
|---|---|---|---|
| SELECT | all rows in org | **all rows in org** ("org_members_read_booking_assignees") | none |
| INSERT/UPDATE/DELETE | yes ("org_managers_write_booking_assignees" FOR ALL) | **none** — any employee-session write matches zero rows and reports success | none |

Consequence: reads of the roster are complete for everyone; writes (accept, completed_at, drop) must go through admin. The "my part is done" bug was this table.

### bookings
Migrations: 20260407230757, 20260411030001 (manager), 20260422050000 (client read), 20260502010000 (archive guard; silently dropped managers), 20261007020000 (crew update + managers restored), 20260913030000 S5 (column guard trigger).

| op | owner/admin/manager | employee | client |
|---|---|---|---|
| SELECT | all in org | all in org ("members read bookings") | own (`client_id` ∈ own clients) |
| INSERT | yes | none | none |
| UPDATE | yes | **only if `is_booking_crew(id)`** (assignee row OR `assigned_to`, active membership) — "managers or crew update bookings"; WITH CHECK `archived_at IS NULL`; trigger S5 refuses any column but `status`, `notes`, `updated_at` for non-managers | none |
| DELETE | yes | none | none |

### memberships
Migration: 20260407044907 only; column grant 20260601040000 (`REVOKE SELECT (pay_rate_cents) … FROM authenticated`).

| op | owner/admin | manager | employee |
|---|---|---|---|
| SELECT | all in own orgs | all in own orgs | all in own orgs ("members can read memberships in their orgs") — **but selecting `pay_rate_cents` errors** for every authenticated role |
| INSERT/UPDATE | yes | **none** | **none** — there is no "update own row" policy (verified: no other migration creates a memberships policy) |
| DELETE | owner only | none | none |

### profiles
Migration: 20260407044907 only. SELECT: own row, plus profiles of active members of shared orgs. UPDATE: own row only. INSERT via trigger. DELETE: none.

### notifications
Migrations: 20260410030000, 20260706010000 (min_role floor). `force row level security` is on.
- SELECT/UPDATE: rows where `recipient_membership_id` ∈ own memberships, OR null-recipient rows whose `min_role` ≤ caller's role rank in that org. So an employee never sees another person's targeted rows and never sees manager-floor org-wide rows.
- INSERT: no user policy — service role / SECURITY DEFINER triggers only.
- DELETE: owner/admin.

### needs_you_state
Migration: 20261029010000. FOR ALL: owner/admin/manager only. Employees: nothing (select included). Cron writes via service role.

### audit_log
Migration: 20260407230757. SELECT: owner/admin only (managers excluded — confirmed in 20260411030001 header). INSERT: any active member for own org. No UPDATE/DELETE.

Helper semantics: `current_user_org_ids()` / `current_user_has_role()` are SECURITY DEFINER over active memberships; `is_booking_crew()` (20261007020000) is SECURITY DEFINER and counts only active memberships.

---

## Step 2 — Per-query inventory on cleaner/subcontractor-reachable paths

Legend: role = who can call it; client = user | admin; decision = what the result feeds; risk = partial-by-RLS **yes / no / unsure** with the limiting policy.

### Hot: taps (startJobAction / completeJobAction) — src/app/field/jobs/actions.ts

| file:line | caller role | table | client | decision it feeds | risk | notes |
|---|---|---|---|---|---|---|
| actions.ts:97-101 | any member | bookings | user | existence, status, scheduled_at of the job being started | no — members read all org bookings | no org filter needed; foreign-org id → null → "Job not found" |
| actions.ts:124-131 | any | booking_assignees (own row) | user | is caller on crew; acceptance gate | no — org-wide SELECT | |
| actions.ts:180-187 | employee/crew | bookings UPDATE status→in_progress | user | **job state for the whole crew** | no (since 20261007020000 crew may update; `.select()` detects zero rows) | before that migration this was the "job stayed confirmed" bug |
| actions.ts:209-215 | any | time_entries (own open) | user | close prior shift / idempotency | no — own rows | |
| actions.ts:221-229 | any | memberships (own) | admin | rate/engagement snapshot | n/a | scoped id+org |
| actions.ts:258-266 | any | time_entries UPDATE own prior | user | closes her other open shift | no — own open row allowed | |
| actions.ts:271, 342 | any | (job-sync) | admin | recompute job state | n/a | see job-sync below |
| actions.ts:273-284 / 295-304 | any | time_entries INSERT | user | her clock-in | no — own insert allowed. **Aside (verified):** trigger S1 (20260913030000:26-68) overwrites `clock_in_at := now()` for employee-role inserts, so the replayed `tapped_at` (punch-time.ts; tap.ts queue) is discarded on clock-in for cleaners; only managers' inserts keep it. Clock-out (an UPDATE) keeps the tap time. Not a crew decision, but a silent write rewrite on the hot path |
| actions.ts:318-325 | any | booking_assignees UPDATE accepted | admin | roster shows her accepted | n/a | scoped booking+membership (no org filter; membership id is unique per org — implicit) |
| actions.ts:334-340 | any | booking_assignees UPDATE completed_at=null | admin | **crew completeness** (clears her stale "done" mark) | n/a | scoped incl. org |
| actions.ts:366-370 | any | bookings | user | status/duration for Complete | no | |
| actions.ts:388-395 | any | booking_assignees (own row) | user | authorization + acceptance | no | |
| actions.ts:418-422 | any | time_entries COUNT own on booking | user | "you never clocked in" refusal (about caller) | no — own rows | |
| actions.ts:444-449 | any | booking_assignees UPDATE completed_at | admin | **crew completeness for the last finisher** | n/a | scoped incl. org; this is the fix for the "my part is done" bug |
| actions.ts:451-464 | any | time_entries UPDATE own open on booking | user | stops her clock | no — own open row | |
| actions.ts:493-501 | any | booking_assignees (all crew rows) | user | **crew size + completed_at per crewmate → stays open or closes** | **no** — SELECT is org-wide for every active member | not partial; no org filter but RLS scopes |
| actions.ts:516-531 → job-sync.ts:67-123 | any | bookings, booking_assignees, time_entries, organizations | admin | **who worked, who is on the clock, window end → crewStillWorking()** | n/a (admin) | this is the fix for the time_entries-partial bug; the read is keyed by booking id only (no org filter — implicit via uuid) |
| actions.ts:569-577 | any | bookings UPDATE status=completed | admin | **job finished for everyone + invoice draft** | n/a | scoped id+org; `.select()` checks match |
| actions.ts:597 → automations.ts:217-300 | any | bookings, clients | admin | draft invoice | n/a | keyed by booking id |

### Hot: Clock page + generic clock — src/app/field/clock/actions.ts, src/app/field/clock/page.tsx

| file:line | caller role | table | client | decision | risk | notes |
|---|---|---|---|---|---|---|
| clock/actions.ts:62-68 | any | time_entries own open | user | already clocked in (caller) | no | |
| clock/actions.ts:81-89 | any | memberships own | admin | rate snapshot | n/a | scoped id+org |
| clock/actions.ts:92-106 | any | time_entries INSERT | user | her off-job shift | no (S1 rewrite applies, see above) | |
| clock/actions.ts:130-137 | any | time_entries own open | user | which shift to close (caller) | no | |
| clock/actions.ts:146-153 | any | time_entries UPDATE own | user | clock-out | no | |
| clock/actions.ts:160 → clock-nag.ts:47-53 | any | notifications UPDATE | admin | retract nudge | n/a | filtered by recipient_membership_id + type only (no org; implicit) |
| clock/actions.ts:163 → syncJob | any | (job-sync) | admin | **may finish the job for the crew** | n/a | correct client |
| clock/page.tsx:31-40 | any | bookings (assigned_to = me, today) | user | her job list | no | |
| clock/page.tsx:41-54 | any | booking_assignees (own rows + nested bookings) | user | her job list / rollover | no | |
| clock/page.tsx:110-131 | any | time_entries own | user | is she clocked in; history | no | |

### Job detail page — src/app/field/jobs/[id]/page.tsx

| file:line | caller role | table | client | decision | risk | notes |
|---|---|---|---|---|---|---|
| page.tsx:70-84 | any | time_entries own on booking | user | Start/Complete button state (caller) | no | |
| page.tsx:88 → loadJobState | any | bookings, booking_assignees, time_entries | admin | **crew facts shown to her (who's here/finished/not arrived)** via jobFactsForMember | n/a | called **before** the assignee gate at :217 with a caller-supplied id — result only consumed at :687 after the gate, so no leak, but an unscoped admin read runs on any id |
| page.tsx:90-109 | any | bookings | user | existence/status | no | foreign org → notFound |
| page.tsx:172-187 | any | booking_assignees own row | user | isAssignee, acceptance, youCompleted | no | |
| page.tsx:273-290 | any | booking_assignees + memberships/profiles names | user | crew list, crew size, even-split share | no — org-wide SELECT; profiles readable for shared-org members | |
| page.tsx:256-263 | any | client_job_requests | user | client notes | unsure (table out of scope) | |

### Job lists — src/app/field/jobs/data.ts (Today + Shifts tabs)

| file:line | caller role | table | client | decision | risk | notes |
|---|---|---|---|---|---|---|
| data.ts:63-68 | any | booking_assignees own rows | user | which jobs are hers, acceptance | no | |
| data.ts:87-97 | any | bookings in(ids) | user | job cards | no | |
| data.ts:106-111 | any | booking_assignees in(booking ids) | user | **crew_size per job → End-job wording, even-split hours** | no — org-wide SELECT | |
| data.ts:132-155 | any | time_entries own | user | clocked_in_since, worked_here (caller) | no | |

### Shift acceptance / drop — src/app/field/jobs/actions.ts

| file:line | caller role | table | client | decision | risk | notes |
|---|---|---|---|---|---|---|
| actions.ts:685-692 | any | booking_assignees UPDATE accepted (own) | admin | roster | n/a | scoped booking+membership; **no check that caller is on the booking** (dropShift has one at :841-850; this does not) |
| actions.ts:700-712 | any | bookings (by caller-supplied id; series siblings) | admin | auto-accept series | n/a | **no org filter, no authorization** — see Step 3 |
| actions.ts:715-720 | any | booking_assignees UPDATE own pending in siblings | admin | roster | n/a | writes limited to caller's membership_id |
| actions.ts:732-787 (after()) | any | bookings, memberships, organizations → email | admin | emails that org's managers "X accepted" | n/a | **cross-tenant notification on a forged booking id** — Step 3 |
| actions.ts:817-823 | any | bookings by id | admin | shift drop | n/a | read before auth, but :841-850 authorizes via own assignee row; foreign booking → "not assigned to you" |
| actions.ts:841-846 | any | booking_assignees own row | admin | authorization | n/a | |
| actions.ts:853-857, 867-888 | any | booking_assignees DELETE/UPDATE, bookings UPDATE assigned_to | admin | **crew composition, primary promotion** | n/a | booking-id scoped (no org filter; implicit) |
| actions.ts:861 → syncJob | any | (job-sync) | admin | **remaining crew may now be finished** | n/a | |
| actions.ts:894-916, 939-959 | any | memberships, organizations → notify/email | admin | manager alert | n/a | org from booking row |
| actions.ts:1026-1042 | any | bookings, shift_change_requests INSERT | admin | series-stop request | n/a | after dropShift authorization |

### Other field surfaces (caller-scoped; listed for completeness)

| file:line | caller role | table | client | decision | risk |
|---|---|---|---|---|---|
| field/layout.tsx:44-55 | any | profiles own, organizations | user | shell | no |
| field/hours/page.tsx:75-83 | any | time_entries own | user | her hours | no |
| field/pay/page.tsx:50-64, 88-99, 139-144, 166-173 | any | organizations, memberships own, time_entries own, payroll_items own, subcontractor_pay_items own | admin | her pay | n/a — all scoped id/employee + org |
| field/time-off/page.tsx:28-34 | any | memberships own | user | engagement | no |
| field/time-off/page.tsx:40-45; profile/page.tsx:109-122 | any | pto_requests own, integration_connections own | admin | her history | n/a (employee/membership id only; implicit) |
| field/profile/actions.ts:85-88 | any | memberships UPDATE own calendar_scope | admin | her calendar | n/a (id only; implicit) |
| field/profile/actions.ts:166-171 | any | integration_connections UPDATE own | admin | disconnect | n/a |
| field/jobs/[id]/photo-actions.ts:142-163 | any | bookings, booking_assignees own | user | authorization for photo | no (explicit org check at :148) |
| field/availability/actions.ts:30-48 | any | availability_* | user | own (manager may target another) | no — role-gated |
| field/training/actions.ts:29-59 | any | training_assignments own | user | own completion | no |
| app/timesheets/actions.ts:329-390, 650-760, 760-850 (self PTO) | any | pto_requests | user insert / admin read+update | own request; `employee_id !== membership.id` check present | n/a |
| app/checklists/actions.ts:475-492 (toggleChecklistItemAction) | any | booking_checklist_items | user | her tick | unsure (table out of scope; no role gate, RLS unknown here) |
| lib/chat-actions.ts:43-52 | any | chat_messages INSERT | user | send | no (RLS = thread membership) |
| lib/chat-actions.ts:59-70 | any | chat_thread_members, profiles | admin | push to other members | n/a — thread id only; safe because the RLS insert above already proved membership |
| lib/chat-actions.ts:141-195 | any | memberships (other), chat_thread_members | admin | DM creation | n/a — explicit org check at :155 |
| lib/chat-data.ts:49-82, 159-170 | any | chat_thread_members own, chat_threads, chat_messages | user | her threads | no |
| lib/chat-data.ts:208-214 | any | memberships | admin | teammate picker | n/a — org scoped |
| lib/feed-actions.ts:114-125 (deleteFeedPostAction) | any | feed_posts | user | delete | unsure — no role check in code; relies on feed_posts RLS (not in scope) |
| lib/feed-data.ts:31-48 | any | feed_posts | user | feed | no (org filter + RLS) |
| api/push/subscribe:49-52, unsubscribe:52-55 | any | memberships own (profile_id = user) | user | bind subscription | no |
| lib/audit.ts:98-100 (logAuditEvent) | any | audit_log INSERT | user | refusal/status audit | no — members may insert; (reads are admin-only, used nowhere on field paths) |
| lib/clock-nag.ts:47-53 | any | notifications UPDATE | admin | mark nudge read | n/a |
| lib/push.ts:59-63 | any | push_subscriptions by membership_id | admin | push | n/a |

Dead/latent: `acceptGpsConsentAction` (field/jobs/actions.ts:613-620) updates **memberships** through the user client; the only UPDATE policy is owner/admin (Step 1), so for an employee it matches zero rows and "succeeds" — same shape as the booking_assignees bug. `GpsConsentBanner` is not mounted anywhere (grep: only its own file imports it), so it is not live today.

### Claim flow — src/app/claim/[token]/{actions.ts,page.tsx}, src/lib/invitation-claim.ts, src/app/join/*
Entirely admin-client; the token resolves a `job_offer_dispatches` row and every subsequent read/write is keyed from that row (`dispatch.organization_id`, `offer.booking_id`). No RLS partiality is possible. Crew decisions made here, all admin: actions.ts:233-236 (assignee rows), :240-246 (replaced person's time_entries → "blocked: clocked_in"), :279-334 (insert/reassign/delete assignee rows, set `assigned_to`, primary). Scoping note: :219-223 and :552-575 read the booking by id with no org filter and the assignee insert at :279 stamps `dispatch.organization_id` rather than `bookingRow.organization_id` — correct only while an offer never points at another org's booking (no cross-org guard on job_offers in code read). join/[token] and /join: admin, keyed by invitation token; `claimInvitation` scopes memberships by `invitation.organization_id` (:64-69, :102-107).

### Manager paths that decide job state (covered only where they decide state)

| file:line | caller role | table | client | decision | risk |
|---|---|---|---|---|---|
| lib/close-job.ts:25-30, 44-52 | owner/admin/manager (gated :21) | bookings | user | close job for everyone | no — managers in update policy since 20261007020000 (was silently zero-row for managers between 20260502010000 and 20261007020000) |
| app/needs-you-actions.ts:53-63 | manager | needs_you_state UPSERT | user | snooze "still working" | no — FOR ALL managers |
| app/needs-you-actions.ts:78-110 | manager | bookings, booking_assignees | admin | remove crew member | n/a — org scoped |
| app/needs-you-actions.ts:139-160 | manager | time_entries | user | clock someone out | no — managers read/update all |
| app/bookings/actions.ts:2808-2819, 2872-2880 (setBookingStatusAction) | manager | bookings | user | status set | no |
| app/timesheets/actions.ts:1303-1341, 1613-1628, 1690-1707, 1823-1846, 1867-1914 | manager (role-checked) | time_entries | user/admin | hours edits → syncJob | no |
| app/bookings/[id]/page.tsx:330-331 | manager | (job-sync) | admin | facts + timeline | n/a — booking already org-resolved via RLS at :170 |
| lib/job-sync.ts:443-451 (syncLiveJobs) | cron | bookings (all orgs) | admin | heartbeat | n/a by design |
| lib/automations.ts:7257-7261, 7296-7302, 7377-7380, 7410-7413 (autoCompletePastBookings) | cron | bookings, time_entries | admin | nightly close | n/a — org-iterated |
| lib/automations.ts:6385-6394, 6493-6496, 6546-6553 (sendShiftClockOutReminders) | cron | time_entries, booking_assignees | admin | nudge/cap | n/a |

---

## Step 3 — Admin-client reads/writes NOT filtered by organization_id (cleaner-reachable or shared helpers)

Tenant-mixing or authorization-relevant (listed first):

1. **src/app/api/ai-chat/route.ts:80-87** — `memberships` by `profile_id` + `status='active'` with `.maybeSingle()`, no org filter and no active-org cookie. For Brian (two active memberships) PostgREST returns a multi-row error → `data` null → 403 "Not available"; for anyone else it picks whichever org, ignoring `cleanops_active_org`. Everything after (:164-184 snapshot of bookings/clients/invoices/tasks) is scoped to whatever org that row named.
2. **src/app/field/jobs/actions.ts:700-712 and 732-787 (acceptShiftAction)** — `bookings` read by caller-supplied id with no org filter and **no check that the caller is on the booking** (dropShift has that check at :841-850; this action does not). Writes stay confined to the caller's own `membership_id` (:685-692, :715-720), but the `after()` block emails **that booking's org's** owners/admins/managers "<caller> accepted <client> on <date>" (via `getOrgManagementRecipients(bkInfo.organization_id)`, org-recipients.ts:16-31) and reads the other org's client name/address into the email. A cleaner in org A posting org B's booking id triggers a management email in org B.
3. **src/app/field/jobs/[id]/page.tsx:88** — `loadJobState(id)` (admin, job-sync.ts:67-123) runs on the raw route param before the `notFound()` (:112) and the assignee gate (:217). Result is not rendered for a foreign or unassigned job, so no leak; still an unscoped admin read on untrusted input.
4. **src/app/claim/[token]/actions.ts:279-286** — assignee insert stamps `dispatch.organization_id`, not `bookingRow.organization_id`; :219-223, :552-575 read the booking by id only. Safe only as long as `job_offers.booking_id` is guaranteed same-org (no guard observed in the code read).

Implicitly scoped (keyed by a uuid that belongs to exactly one org — not mixing, but no `organization_id` predicate):

5. src/lib/job-sync.ts:69-75, 80-101 (`load`: bookings/booking_assignees/time_entries by booking id); :363-371 (audit_log by entity_id); :397-402 (bookings status write by id); :233-245 (invoices/bookings by booking id).
6. src/app/field/jobs/actions.ts:318-325 (booking_assignees by booking+membership), :685-692, :715-720, :817-823, :841-888 (dropShift reads/writes by booking id), :894-898 (memberships by id), :1026-1030.
7. src/lib/clock-nag.ts:48-53 — notifications by `recipient_membership_id` + type.
8. src/lib/notify.ts:99-101 — memberships by id. src/lib/push.ts:59-63 — push_subscriptions by membership_id.
9. src/app/field/profile/actions.ts:85-88 (memberships update by own id), :166-171; src/app/field/time-off/page.tsx:40-45 and src/app/field/profile/page.tsx:109-122 (pto_requests / integration_connections by employee/membership id).
10. src/lib/google-calendar.ts:1860+ (`deleteMemberCalendarEvent`), 2014+ (`syncMemberCalendarEvents`), 2123+ (`cleanupMemberCalendarEvents`) — booking_member_calendar_events / booking_assignees / bookings by booking or membership id.
11. src/lib/chat-actions.ts:61-65 (chat_thread_members by thread id — safe because the RLS insert at :43-52 already proved membership), :141-145 (memberships by id, then org compared at :155).
12. src/lib/crew-hours.ts:112-125, 211-227 — booking_assignees/bookings by booking id(s), then org from the row.

Not reached by cleaners (noted, not audited): the long admin-client inventory in src/app/app/**, src/lib/{stripe,square,sage,quickbooks,tenant-data,…}, src/app/api/v1/** (API-key auth scopes `auth.organizationId`), src/app/api/cron/** (CRON_SECRET, org-iterated).

---

## Step 4 — Ranked: partial-by-RLS = yes

**None remain on the field app, claim flow, or manager job-state paths as of HEAD (b9075e4).** Every query that decides about someone other than the caller against time_entries now goes through the admin client (`loadJobState`/`syncJob`), and every employee write to booking_assignees goes through the admin client. The two bugs described in the brief are fixed in the code read:

- time_entries-partial crew read → replaced by `loadJobState(bookingId)` at src/app/field/jobs/actions.ts:516 (admin).
- booking_assignees zero-row employee write → admin writes at src/app/field/jobs/actions.ts:444-449 (completed_at), :334-340 (clear), :318-325 and :685-692 (accept), :853-857 (drop).

Ranked residual list — nearest to the same shape, hottest first:

1. **src/app/field/jobs/actions.ts:613-620 `acceptGpsConsentAction`** — employee `memberships` UPDATE through the user client; only UPDATE policy is owner/admin (20260407044907:318-327), so it matches zero rows and returns success. Currently unreachable (banner not mounted), so dormant, but it is a live zero-row write the moment the banner is rendered.
2. **src/app/field/jobs/actions.ts:273-284, 295-304 and src/app/field/clock/actions.ts:92-106** — employee `time_entries` INSERT through the user client: trigger S1 (20260913030000) silently replaces the replayed `tapped_at` with `now()`. Not a decision about others, but it is the hottest path, and the queued-tap feature (tap.ts:95-179, punch-time.ts) believes the tap time survived. Clock-out keeps the tap time; clock-in does not, for role=employee.
3. **src/app/field/jobs/actions.ts:700-787 `acceptShiftAction`** — not partial, the inverse: admin client with no crew/org authorization (Step 3 #2).
4. **src/app/api/ai-chat/route.ts:80-87** — org selection ignores the active-org cookie; multi-org users get 403 (Step 3 #1).

Unsure rows (tables outside the eight in scope, no policy read): checklist toggle (app/checklists/actions.ts:475-492), feed delete (lib/feed-actions.ts:114-125), client_job_requests read (field/jobs/[id]/page.tsx:256-263).
