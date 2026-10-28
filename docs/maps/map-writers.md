# Job-state writers map (cleanops, read-only inventory, 2026-10-28)

All paths relative to `C:\Users\musil\Documents\BPMMEDIACO\cleanops\`. Line numbers are from the working tree at HEAD `b9075e4`.

## 0. What the state actually reads

From `load()` in `src/lib/job-sync.ts:67-157` (the only loader `syncJob`, `loadJobState`, `syncLiveJobs` use):

| Table | Columns read | Notes |
|---|---|---|
| `bookings` | `status`, `scheduled_at`, `duration_minutes`, `total_cents`, `hourly_rate_cents`, `is_free`, `closed_at`, `divide_hours_evenly`, `organization_id` | `closed_by`, `assigned_to`, `scheduled_local`, `scheduled_tz`, `archived_at`, `time_set_by_hand_at`, `splits`, every `*_sent_at` are NOT read. There are no `cancelled_*` fact columns; only `cancelled_email_sent_at` (not read). |
| `booking_assignees` | row existence (=rostered), `membership_id`, `split_start_offset_minutes`, `split_duration_minutes` | `is_primary`, `acceptance_status`, `responded_at`, `completed_at`, `confirm_*` are NOT read by the rules (`completed_at` is read by `crew-completion.ts` inside `completeJobAction`, not by `deriveJobState`). |
| `time_entries` | rows where `booking_id = <id>`: `employee_id`, `clock_in_at`, `clock_out_at` (`auto_closed_at` for the timeline label only) | `needs_review`, `payroll_run_id`, `work_category` not read. A `booking_id` change moves a shift between jobs. |
| `organizations` (not named in the brief) | `automation_settings.auto_complete_past_bookings.enabled`, `automation_settings.divide_crew_hours.enabled`, `booking_auto_complete_hours`, `timezone` | These change `closesAtMs` / `windowEndMs` for every open job in the org at once. |

Price fields only affect `needs: ["price"]`, never `status`/`phase`.

Recompute entry points: `syncJob` (`job-sync.ts:333`), `syncLiveJobs` (`job-sync.ts:435`, every 30 min from `/api/cron/shift-reminders` L107, covers open jobs started in the last 3 days), `closeJob` (`src/lib/close-job.ts:15`, calls `syncJob` at L67).

No `.rpc()` call anywhere in `src/` or `scripts/` writes any of the four tables (all 16 are reads or touch checklists/chat/audit/sms). No DB trigger writes `status`, `closed_at`, `clock_out_at`, or `booking_assignees`.

## 1. Every writer

Kind legend: SA = server action, API = `/api/v1` route (API key), CRON = Vercel cron, LIB = helper called from elsewhere, SCRIPT, TRIG = DB trigger/function, DIRECT = PostgREST write with the user's JWT (no app code). "User" = RLS-bound server client; "admin" = service-role client.

### 1a. Cleaner taps (field app)

| # | file:line | kind | who | fields changed | recompute after? | audit_log? | notes |
|---|---|---|---|---|---|---|---|
| 1 | `src/app/field/jobs/actions.ts:181` `startJobAction` | SA | any active crew member (assignee row or `assigned_to`) | `bookings.status=in_progress` (user client) | yes, `syncJob(bookingId,"clock_in")` L342 | yes L196 `status_change` | Writes the status directly first, sync after. `.select()` catches a zero-row match. |
| 2 | `src/app/field/jobs/actions.ts:260` same action, prior open shift | SA | same | `time_entries.clock_out_at` on the OTHER open entry (user client) | yes, `syncJob(prior.booking_id,"clock_out")` L271 | no | Correct booking: id read from the entry row. |
| 3 | `src/app/field/jobs/actions.ts:275` / `:295` same action | SA | same | `time_entries` INSERT (`booking_id`, `clock_in_at=punchedAt`) via user client | yes L342 | no | **DB trigger `time_entries_employee_insert_guard` rewrites `clock_in_at := now()` for non-managers** (see row 59), so the phone's punch time is discarded for cleaners; the sync at L342 sees `now()`. |
| 4 | `src/app/field/jobs/actions.ts:320` / `:336` same action | SA | same | `booking_assignees.acceptance_status/responded_at`; `completed_at=null` (admin, own row) | yes L342 | no | Not state-read columns. |
| 5 | `src/app/field/jobs/actions.ts:446` `completeJobAction` | SA | any crew member who has a shift on the job | `booking_assignees.completed_at=now` (admin, own row) | yes (every exit path after the writes: L534, L554, L598) | only on the full-complete path L584 | `completed_at` not read by rules. |
| 6 | `src/app/field/jobs/actions.ts:453` same action | SA | same | `time_entries.clock_out_at` for own open entries on this job (user client) | yes L534/554/598 | no entry-level row | |
| 7 | `src/app/field/jobs/actions.ts:571` same action, last finisher | SA | same | `bookings.status=completed` (admin, org-filtered) — **no `closed_at`** | yes L598 (after `autoInvoiceOnJobComplete`) | yes L584 | Rules will agree only if every rostered person worked or the window is over; otherwise shadow logs a disagreement. |
| 8 | `src/app/field/clock/actions.ts:92` `clockInAction` | SA | any active member | `time_entries` INSERT with `booking_id=null` | n/a (not a job) | no | Off-job punch. Insert guard applies (row 59). |
| 9 | `src/app/field/clock/actions.ts:148` `clockOutAction` | SA | any active member | `time_entries.clock_out_at` on own latest open entry (user client) | yes `syncJob(open.booking_id,"clock_out")` L163 | no | Correct booking: from the entry row. |
| 10 | `src/app/field/jobs/actions.ts:855` `dropShift` (called by `declineShiftAction` L971, `cancelShiftAction` L983, `requestSeriesStopAction` L1004→L1015, `callInSickAction` L1052) | SA | the cleaner herself (must be on the booking; checked L842-851) | `booking_assignees` DELETE own row (admin) | yes `syncJob(bookingId,"crew_dropped")` L861 | no audit_log row (push + email only) | After sync: `bookings.assigned_to` L881 and `is_primary` L886 (not state-read). |
| 11 | `src/app/field/jobs/actions.ts:687` / `:717` `acceptShiftAction` | SA | the cleaner | `booking_assignees.acceptance_status/responded_at` (own rows, admin; also every future sibling in the series) | no (none needed) | no | Not state-read. |

### 1b. Manager server actions

| # | file:line | kind | who | fields changed | recompute after? | audit_log? | notes |
|---|---|---|---|---|---|---|---|
| 12 | `src/app/app/bookings/actions.ts:741` `createBookingAction` | SA | any member RLS lets insert (no explicit role gate; bookings insert policy is manager+) | INSERT `status` (any writable status from the form), `scheduled_at`, `duration_minutes`, `total_cents`, `is_free`, `divide_hours_evenly`, `splits` (user client) | no (new row) | no | **`status=completed` on create writes no `closed_at`.** Then crew rows via helper row 13. |
| 13 | `src/app/app/bookings/actions.ts:211` `syncBookingAssignees` (helper; `delete` L278, `insert` L364, restore-on-failure L376) | LIB | called by rows 12, 14, 16, 22 | `booking_assignees` DELETE all rows for the booking + INSERT the form's set, with `split_*` offsets; prior `acceptance/completed_at` carried via `crew-sync.ts` | **no, never itself** — relies on the caller | no | user client. Delete+insert is not transactional. |
| 14 | `src/app/app/bookings/actions.ts:1145` `createRecurringBookingAction` | SA | same as 12 | UPSERT N new `confirmed` rows (`onConflict series_id,scheduled_at`), then row 13 per occurrence | no (new rows) | no | |
| 15 | `src/app/app/bookings/actions.ts:1526` `updateBookingAction` (edit form) | SA | owner/admin/manager (gated L1319) | `status`, `scheduled_at`, `scheduled_local/tz`, `duration_minutes`, `closed_at/closed_by` (set on →completed, cleared otherwise), `total_cents`, `is_free`, `divide_hours_evenly`, `splits` (user client) | yes `syncJob(id,"edit_form")` L2224 — **for the edited id only** | yes L1559 `status_change`, only when status changed; no row for date/duration/crew edits | `existing` (L1369) is fetched via RLS with no null check: a foreign id gives a silent 0-row update and still reaches `syncJob(id)` on a booking the caller doesn't own (shadow: `state_check` row under the other org). |
| 16 | `src/app/app/bookings/actions.ts:1433`→row 13 (crew rebuild inside 15) | SA | same | `booking_assignees` rebuilt for the edited booking | yes via L2224 | no | |
| 17 | `src/app/app/bookings/actions.ts:1895` (this_and_future with schedule change, inside 15) | SA | same | DELETE future `pending/confirmed` siblings (admin, org-filtered) | n/a (rows gone; `time_entries.booking_id` → NULL by FK) | no | Live `in_progress` siblings are excluded from the delete. |
| 18 | `src/app/app/bookings/actions.ts:1952` + `syncBookingAssigneesBulk` L403 (`delete` L459, `insert` L542) (inside 15) | SA | same | UPSERT regenerated `confirmed` siblings; crew rows for all of them | no (new rows) | no | |
| 19 | `src/app/app/bookings/actions.ts:2058` + bulk crew rebuild (this_and_future WITHOUT schedule change, inside 15) | SA | same | `duration_minutes`, `total_cents`, `assigned_to`, … on every future non-completed/cancelled sibling (admin); `booking_assignees` deleted+reinserted for all of them | **no** — only the edited `id` is synced (L2224); siblings' window/crew change without recompute | no | A future sibling can be `in_progress` (early start) and is included. |
| 20 | `src/app/app/bookings/actions.ts:2476` / `:2522` `convertBookingToRecurringAction` + bulk crew | SA | owner/admin/manager | `series_id` on the source (not state); UPSERT new `confirmed` rows + crew | no (new rows) | no | |
| 21 | `src/app/app/bookings/actions.ts:2638` / `:2686` `duplicateBookingImpl` (`rebookBookingAction` L2582, `duplicateBookingAction` L2586) | SA | no role gate (RLS) | INSERT `pending` copy + copied `booking_assignees` incl. `split_*` | no (new row) | no | |
| 22 | `src/app/app/bookings/actions.ts:3580` + row 13 `assignBookingCrewAction` (quick-assign dialog) | SA | owner/admin/manager (L3538) | `bookings.assigned_to` (not state-read); `booking_assignees` rebuilt for the booking (user client) | yes `syncJob(id,"crew_changed")` L3752 — edited id only | no | Refuses split bookings (L3568). |
| 23 | `src/app/app/bookings/actions.ts:3694` / `:3701` / `:3733` (this_and_future inside 22) | SA | same | siblings: `assigned_to`; `booking_assignees` DELETE + INSERT (admin, **no org filter on the delete/insert; ids come from an org-filtered select**) | **no** for siblings | no | Inserts carry no `split_*`, no acceptance carry-over. |
| 24 | `src/app/app/bookings/actions.ts:2771` `markBookingCompleteAction` → `closeJob` | SA | owner/admin/manager (inside `closeJob`) | see row 46 | yes (inside `closeJob`) | yes | |
| 25 | `src/app/app/bookings/actions.ts:2873` `setBookingStatusAction` (list/scheduler dropdown) | SA | owner/admin/manager (L2808) | `status`, `closed_at`, `closed_by` (set on completed, cleared otherwise) (user client, org-filtered) | yes `syncJob(id,"status_set")` L2898 | yes L2886 | Transition table + `futureStatusError` + billed guard first. |
| 26 | `src/app/app/bookings/actions.ts:2982` `setSeriesStatusAction` | SA | owner/admin/manager | loops row 25 over ≤60 siblings | yes, per sibling via 25 | yes, per sibling | |
| 27 | `src/app/app/bookings/actions.ts:3125` (cascade, admin) / `:3213` (single, user) `deleteBookingAction` | SA | owner/admin/manager (L3050) | DELETE booking(s) → `booking_assignees` cascade, `time_entries.booking_id` SET NULL | n/a (row gone) | **no** audit_log row | Hours on a deleted job become unattached off-job entries. |
| 28 | `src/app/app/bookings/actions.ts:3307` `skipBookingOccurrenceAction` | SA | no role gate (RLS) | DELETE the future occurrence (+ `booking_series.skip_dates`) | n/a | no | Future-only (refuses past). |
| 29 | `src/app/app/bookings/actions.ts:3381` `cancelSeriesAction` | SA | **no role gate** (user client; RLS update policy = managers OR any crew member of each row, column guard permits `status`) | `bookings.status=cancelled` for every future `pending/confirmed` row in the series | **no** | **no** audit_log row | Also deactivates the series. Cancellation notices sent. |
| 30 | `src/app/app/needs-you-actions.ts:38` `closeJobAction` → `closeJob` | SA | manager+ | row 46 | yes | yes | |
| 31 | `src/app/app/needs-you-actions.ts:88` `removeMemberAction` ("Remove from job") | SA | owner/admin/manager (L74) | `booking_assignees` DELETE one row (admin, org-filtered); then `assigned_to`/`is_primary` | yes `syncJob(bookingId,"crew_changed")` L122 | yes L115 (action `assign`) | Booking existence checked with org filter first. |
| 32 | `src/app/app/needs-you-actions.ts:158` `clockOutAtAction` | SA | owner/admin/manager | `time_entries.clock_out_at` (+`needs_review=true`), guarded on `clock_out_at IS NULL` (user client) | yes L173 | yes L165 | **Explicitly validates `bookingId === entry.booking_id`** (L148) before syncing — the one writer that defends against a wrong id. |
| 33 | `src/app/app/needs-you-actions.ts:201` `restoreSeriesTimesAction` | SA | owner/admin/manager | `bookings.scheduled_at` (+ reminder re-arm) per drifted visit, admin, guarded on the prior `scheduled_at` | yes `syncJob(v.id,"rescheduled")` L218 per moved visit | yes L210 | Ids come from server-side `collectSeriesDrift`, not the client. |
| 34 | `src/app/app/needs-you-actions.ts:285` `keepSeriesTimesAction` | SA | manager+ | `time_set_by_hand_at` only | n/a (not state) | yes | |
| 35 | `src/app/app/scheduling/actions.ts:286` `rescheduleBookingAction` (calendar drag) | SA | owner/admin only (L95) | `scheduled_at`, `scheduled_local/tz`, optionally `assigned_to` (user client, `.eq("id")` only, no row-count check) | yes `syncJob(id,"rescheduled")` L412 | **no** audit_log row | `current` is RLS-fetched and null-checked (L113), so a foreign id stops early. |
| 36 | `src/app/app/scheduling/actions.ts:314` / `:324` / `:339` / `:344` (crew swap inside 35) | SA | same | `booking_assignees` DELETE removed, UPSERT added (`is_primary=false`), then `is_primary` flip | yes via L412 | no | Split bookings never reach here. |
| 37 | `src/app/app/timesheets/actions.ts:1082` `createManualTimeEntryAction` | SA | owner/admin/manager | INSERT closed `time_entries` (`booking_id`, `clock_in_at`, `clock_out_at`) (user client; managers bypass the insert guard) | yes L1118 if `booking_id` | yes L1105 | Booking id from the form; validated against org at L1553-style check earlier in the action (`readManualTimeFormValues`). |
| 38 | `src/app/app/timesheets/actions.ts:1304` `updateTimeEntryAction` | SA | owner/admin/manager | `employee_id`, `booking_id`, `clock_in_at`, `clock_out_at`, `needs_review=false` | yes L1340 for BOTH old and new `booking_id` | yes L1325 | New `booking_id` validated in-org L1187. Frozen (run-stamped) entries refused. |
| 39 | `src/app/app/timesheets/actions.ts:1614` `attachEntryToBookingAction` | SA | owner/admin/manager | `time_entries.booking_id` (null → booking) | yes L1628 (target booking) | yes L1619 | Target booking checked in-org L1553; employee must be on the crew L1597. |
| 40 | `src/app/app/timesheets/actions.ts:1691` `bulkDeleteTimeEntriesAction` | SA | owner/admin/manager | DELETE ≤100 entries | yes L1707, one per distinct `booking_id` | yes, per row L1697 | |
| 41 | `src/app/app/timesheets/actions.ts:1824` `closeOpenShiftAction` ("missing punches" banner) | SA | owner/admin/manager | `clock_out_at`, `needs_review=false`, `over_confirmed_*` | yes L1846 | yes L1837 | |
| 42 | `src/app/app/timesheets/actions.ts:1901` `deleteTimeEntryAction` | SA | owner/admin/manager | DELETE one entry | yes L1914 | yes L1906 | |
| 43 | `src/app/app/timesheets/actions.ts:1943` `confirmTimeEntryAction` | SA | manager+ | `needs_review`, `over_confirmed_*` only | n/a (not state) | yes | |
| 44 | `src/app/app/bookings/requests/client-job-request-actions.ts:60` `resolveClientSkipAction` (accept a client's skip) | SA | owner/admin/manager | `bookings.status=cancelled` (admin, org-filtered) | **no** | **no** booking audit row (request row updated only) | Crew notified in `after()`. |
| 45 | `src/app/app/clients/actions.ts:458` `archiveClientAction` → `src/lib/client-offboarding.ts:130` `sweepArchivedClient` | SA→LIB | owner/admin (clients/actions.ts gate) | `bookings.status=cancelled` for the client's `pending/confirmed` rows since the lookback (admin, org-filtered, billed rows excluded) | **no** | **no** per-booking audit row | Calendar teardown + crew push only for future rows. |
| 46 | `src/lib/close-job.ts:46` `closeJob` | LIB | owner/admin/manager (gated L21); callers rows 24, 30 | `status=completed`, `closed_at=now`, `closed_by=membership.id` (caller's user client, org-filtered) | yes `syncJob(bookingId,"manager_close")` L67 (after `autoInvoiceOnJobComplete` L65) | yes L55 (`via: close_job`) | Refuses pending / cancelled / too-early. |
| 47 | `src/app/app/employees/actions.ts:~595` (deactivate member) → `src/lib/member-offboarding.ts:141` `sweepDeactivatedMember` | SA→LIB | owner/admin | `booking_assignees` DELETE the member's rows on FUTURE open bookings (admin) | yes `syncJob(id,"crew_offboarded")` L147 per booking | no per-booking row (member-level `deactivate` audit in the caller) | Past bookings where she is a no-show keep her row (by design: `scheduled_at < now` skipped). `bookings.assigned_to=null` at L134 is not state-read. |
| 48 | `src/lib/member-offboarding.ts:160` same sweep | LIB | same | `time_entries.clock_out_at=now`, `needs_review`, `auto_closed_at` on every open entry of the member | yes `syncJob(row.booking_id,"clock_out")` L178 | no entry-level row | |

### 1c. Client portal and public claim links

| # | file:line | kind | who | fields changed | recompute after? | audit_log? | notes |
|---|---|---|---|---|---|---|---|
| 49 | `src/app/client/(portal)/jobs/[id]/actions.ts:234` `requestSkipAction` (auto-applied skip) | SA | **the client** (portal login) | `bookings.status=cancelled` (admin, filtered by `client_id`) | **no** | **no** (a `client_job_requests` row only) | Only when `clientBookingActions(...).skipAutoApplies`; otherwise it queues for row 44. |
| 50 | `src/app/claim/[token]/actions.ts:279` / `:304` / `:315` / `:328` / `:332` `claimOfferAction` | SA | **anyone holding a job-offer claim token** (bench/freelancer; public URL, token-authenticated) | `booking_assignees` INSERT claimer (accepted); on a swap UPDATE `membership_id` of the replaced person's row, or DELETE it; `is_primary` flips; `bookings.assigned_to` (L292, L322) | **no** | one `audit_log` row for the `job_offer` (entity `settings`, L354) — nothing on the booking | Admin client. Crew membership (who is rostered) changes with no recompute. Calendars re-synced. |

### 1d. Public API (API key)

| # | file:line | kind | who | fields changed | recompute after? | audit_log? | notes |
|---|---|---|---|---|---|---|---|
| 51 | `src/app/api/v1/bookings/route.ts:209` POST | API | API key | INSERT `status` (validated writable + `futureStatusError`), `scheduled_at`, `duration_minutes`, `total_cents`, `hourly_rate_cents`, `assigned_to` (admin) | no (new row) | **no** (webhook only) | **No `booking_assignees` row is written** — the rules see crew=[] even with `assigned_to` set. **`status=completed` writes no `closed_at`.** |
| 52 | `src/app/api/v1/bookings/[id]/route.ts:192` PATCH | API | API key | any of `scheduled_at`, `duration_minutes`, `status`, `total_cents`, `hourly_rate_cents`, `assigned_to`, …; `closed_at` set/cleared when status changes (`closed_by=null`), `time_set_by_hand_at` on date change (admin, org-filtered, `.single()`) | yes `syncJob(id, api_status|api_edit)` L236 on every PATCH | yes L218, only when status changes | `.single()` errors on 0 rows, so a foreign id never reaches `syncJob`. |
| 53 | `src/app/api/v1/bookings/[id]/route.ts:276` DELETE | API | API key | DELETE (admin, org-filtered) | n/a | **no** | Hours orphaned (FK SET NULL). |

### 1e. Crons and library automations (admin client)

| # | file:line | kind | who | fields changed | recompute after? | audit_log? | notes |
|---|---|---|---|---|---|---|---|
| 54 | `src/lib/job-sync.ts:399` `syncJob` (write mode only, `JOB_STATE_WRITE=1`) | LIB | every caller above | `bookings.status` = derived, guarded on the status it read | — (is the recompute) | yes L406 `status_change` (actor null); shadow mode writes `state_check` L377 | Drafts the invoice on completed L415. |
| 55 | `src/lib/automations.ts:7411` `autoCompletePastBookings` (`/api/cron/complete-bookings`, nightly) | CRON | cron | `bookings.status=completed` for staffed `confirmed/in_progress` rows past the org's cutoff with no open shift — **no `closed_at`** | yes `syncJob(b.id,"nightly_sweep")` L7450 per row (after `autoInvoiceOnJobComplete`) | **no** audit_log row (console.log only) | Gated on `auto_complete_past_bookings`; unstaffed/pending rows are reported, not flipped. |
| 56 | `src/lib/automations.ts:6547` `sendShiftClockOutReminders` cap (`/api/cron/shift-reminders`, every 30 min) | CRON | cron | `time_entries.clock_out_at=expectedEnd+grace`, `auto_closed_at`, `needs_review=true`, guarded on `clock_out_at IS NULL` | yes `syncJob(e.booking_id,"shift_capped")` L6572 (verified: inside the same block as `clearClockOutNag`, conditional only on `e.booking_id`) | **no** audit_log row (notify + SMS only) | Org toggle; skipped orgs are listed in the result. |
| 57 | `src/lib/automations.ts:4229` / `:4290` `autoExtendRecurringSeries` (`/api/cron/extend-series`, 04:00) | CRON | cron | UPSERT new `confirmed` occurrences (`onConflict series_id,scheduled_at`); UPSERT `booking_assignees` from `booking_series.crew` incl. `split_*` and inherited acceptance | no (new rows) | no | |
| 58 | `src/lib/scheduled-local-job.ts:62` / `:80` `rederiveScheduledInstants` (`/api/cron/rederive-times`, nightly) | CRON | cron | `bookings.scheduled_at` (+`scheduled_local/tz`) for FUTURE non-cancelled/completed visits whose wall clock re-derives differently, guarded on the prior instant | **no** | yes L82 (`logSystemAuditEvent`, `via: wall_clock_rederive`) | Future rows only, so a window move matters only for a job started early (`in_progress` with future `scheduled_at` is included). |
| 59 | `src/lib/automations.ts:816` `autoBookingOnEstimateApproval` (event from estimate approval) | LIB | public estimate approval flow | INSERT `pending` placeholder (tomorrow 09:00, 120 min) | no (new row) | no | |
| 60 | `src/lib/automations.ts:7492` `autoArchiveOldRecords` | CRON | cron | `archived_at` on completed/cancelled rows | n/a (not read by rules; `syncLiveJobs` doesn't filter on it either) | no | Archived rows are immutable to signed-in users (RLS). |
| 61 | `src/lib/automations.ts:8078` / `:8096` `chaseUnconfirmedShifts`; `:6311` / `:6344` `runJobWatch`; `:548` `autoInvoiceOnJobComplete`; `:1108/1142/1343/1595/2575/2642/3387/4590` notification stamps | CRON/LIB | cron | `confirm_*`, `no_show_nudge_sent_at`, `no_clock_in_flagged_at`, `billing_invoice_id`, `*_sent_at`, `review_token` | n/a (none read by rules) | no | Listed for completeness; they do touch `bookings`/`booking_assignees` but not a state fact. |
| 62 | `src/lib/google-calendar.ts:564/634/1240/1347/1492`, `src/app/api/admin/gcal-*`, `src/app/api/cron/billing-cycle/route.ts:326/441`, `src/app/app/invoices/actions.ts:167/1220/1659/1723`, `src/lib/payroll-run-create.ts:398/429`, `src/lib/contractor-run-create.ts:213/227`, `src/app/client/(portal)/jobs/page.tsx:68` | various | — | `google_calendar_event_id`, `billing_invoice_id`, `payroll_run_id`, `subcontractor_run_id`, `review_token` | n/a | — | Not state facts. There is no inbound Google Calendar sync that writes `scheduled_at`. |

### 1f. Org settings the rules read (not named in the brief)

| # | file:line | kind | who | fields changed | recompute after? | audit_log? | notes |
|---|---|---|---|---|---|---|---|
| 63 | `src/app/app/settings/thresholds/actions.ts:78` | SA | owner/admin | `organizations.booking_auto_complete_hours` | **no** (`syncLiveJobs` heartbeat catches open jobs within 30 min) | no | Moves `closesAtMs` for every open staffed job. |
| 64 | `src/app/app/settings/automations/actions.ts:236`, `:393`, `:469`, `:516` | SA | owner/admin | `organizations.automation_settings` (incl. `auto_complete_past_bookings`, `divide_crew_hours`) | **no** (heartbeat only) | no | `divide_crew_hours` changes `teamMinutes` → window end of every team job (L397 block reshapes calendar events in `after()`, not state). |
| 65 | `src/app/app/settings/sms/actions.ts:89` | SA | owner/admin | `automation_settings` (SMS keys only) | n/a | no | |

### 1g. Scripts and tenant purge (cold)

| # | file:line | kind | who | fields changed | recompute after? | audit_log? | notes |
|---|---|---|---|---|---|---|---|
| 66 | `scripts/seed.ts:441` | SCRIPT | developer | INSERT demo bookings with `confirmed/in_progress/pending/cancelled/completed`, `assigned_to` only (no `booking_assignees`, no `time_entries`) | no | no | Dev seed. |
| 67 | `scripts/import-all-data.ts:259` / `:269` | SCRIPT | developer | UPSERT `bookings` and `time_entries` from a JSON export (`onConflict: id`) | no | no | Also `booking_series`, `job_offers`; no `booking_assignees` import line in the shown block. |
| 68 | `scripts/wipe.ts:139` | SCRIPT | developer | DELETE every row of `time_entries`, `bookings`, … | n/a | n/a (audit_log wiped too) | |
| 69 | `src/lib/tenant-data.ts:496-538` org purge (`DELETE_ORDER`) | LIB | platform admin flow | DELETE `booking_assignees`, `time_entries`, `bookings` for a tombstoned org | n/a | via `purge_org_audit_log` RPC | |
| 70 | `scripts/replay-job-state.ts`, `scripts/shadow-morning-check.ts`, `scripts/series-drift-report.ts`, `scripts/export-*.ts`, `scripts/verify-*.ts` | SCRIPT | — | read-only | — | — | |

### 1h. Database triggers, functions, one-off migration DML

| # | file:line | kind | who | fields changed | recompute after? | audit_log? | notes |
|---|---|---|---|---|---|---|---|
| 71 | `supabase/migrations/20260913030000_insider_guards.sql:66` `time_entries_employee_insert_guard` (BEFORE INSERT) | TRIG | fires on every `time_entries` INSERT by a non-manager JWT (service role and managers exempt) | rewrites `NEW.clock_in_at := now()`, `clock_out_at := null`, run ids null, rate/engagement snapshots | n/a (the inserting action syncs after) | no | **Changes the fact rows 3 and 8 write: a cleaner's `punchedAt` is replaced by the server clock.** Managers' and admin-client inserts keep their values. |
| 72 | `20260804010000_booking_future_status_guard.sql:54` `bookings_reject_premature_status_trg` (BEFORE INSERT/UPDATE OF status, scheduled_at) | TRIG | all writers | none — RAISEs when `completed/in_progress` and `scheduled_at > now()+4h` | — | — | Mirrors `futureStatusError`. |
| 73 | `20260913030000_insider_guards.sql:179` `bookings_assignee_column_guard` (BEFORE UPDATE) | TRIG | non-manager JWT writers | none — RAISEs unless only `status`, `notes`, `updated_at` changed | — | — | Lets crew flip `status` directly (see row 77). |
| 74 | `20261030020000_booking_wall_clock.sql:96` `bookings_keep_wall_clock_trg` (BEFORE INSERT/UPDATE OF scheduled_at, scheduled_local, scheduled_tz) | TRIG | all writers | derives `scheduled_local`/`scheduled_tz` when the writer set only the instant | n/a (not read by rules) | no | |
| 75 | `20260420020000_admin_automations.sql:39` `bookings_clear_unassigned_alert_trg`; `20260708010000`/`20260826010000` `apply_*_checklist_after_booking_insert`; `20260407230756:179` `bookings_set_updated_at` | TRIG | — | `unassigned_alert_sent_at`, checklist items, `updated_at` | n/a | — | Not state facts. |
| 76 | One-off DML already applied: `20261028010000_booking_closed.sql:23` (`closed_at` backfill for completed rows), `20260716040000_booking_status_simplify.sql:11` (`pending/en_route → confirmed`), `20260815010000_series_occurrence_unique.sql:31` (duplicate-occurrence DELETE), `20260525010000_booking_assignees_splits.sql:29-56` (assignee rebuild from `splits`), `20260613020000_shift_acceptance.sql:19` (acceptance grandfather), `20260813010000` (engagement snapshot backfill), `20261030020000:57` (wall-clock backfill) | migration | nobody-yet (historical) | as named | no | no | Nothing in these is callable at runtime; no RPC wraps them. |

### 1i. Direct PostgREST writes (browser + user JWT, no app code at all)

| # | policy | kind | who | fields changed | recompute after? | audit_log? | notes |
|---|---|---|---|---|---|---|---|
| 77 | `bookings` UPDATE — `20261007020000_crew_update_bookings.sql` "managers or crew update bookings" + column guard (row 73) | DIRECT | any active crew member of the row (status/notes only); owner/admin/manager (any column incl. `closed_at`, `scheduled_at`, `duration_minutes`) | `status` etc. | **no** | **no** | Requires intent (devtools / curl with the anon key + session). Covered only by the heartbeat if the job is open and within 3 days. |
| 78 | `time_entries` INSERT "employees insert own time_entries" (`20260407230757_domain_rls.sql:474`) + UPDATE "employees update own open time_entries or admins all" (`20260829030000_lock_closed_time_entries.sql:20`) + managers all; DELETE managers | DIRECT | any active member on own rows; managers on all | INSERT (guard row 71 rewrites it to an honest open row), set `clock_out_at` on own open entry, `booking_id` | **no** | **no** | |
| 79 | `booking_assignees` | DIRECT | managers only (no member-level write policy — stated in `field/jobs/actions.ts:412-416` and `:683-685`) | any | **no** | **no** | |

## 2. Writers that do NOT recompute, ranked by how often Svit's org hits them

Hot = daily at Svit, Warm = weekly/occasional, Cold = rare or not used.

| Rank | Writer | Temp | Fact changed without recompute | Why it matters / caveat |
|---|---|---|---|---|
| 1 | Edit form `this_and_future` propagation — rows 19 (no schedule change: `duration_minutes` + crew rebuilt on every future sibling) and 23 (quick-assign siblings) | **Warm-hot** (95% of Svit's work is recurring; series edits are routine) | `duration_minutes`, `booking_assignees` on N siblings; only the edited id is synced | Siblings are usually `not_started`, where neither field changes the stored status — until one is `in_progress` (early start) or the heartbeat picks it up within 3 days of its start. Net effect today: mostly latent, but the audit trail has nothing for those siblings. |
| 2 | `cancelSeriesAction` (row 29) | Warm | `status=cancelled` on future `pending/confirmed` rows | Rules treat `cancelled` as terminal and never overrule it, so the stored status is already what the rules would say; what's missing is the per-booking `status_change` audit row and any sync. Also no role gate. |
| 3 | `createBookingAction` / API POST with `status=completed` and no `closed_at` (rows 12, 51) | Warm (back-filled past jobs) | `status=completed`, `closed_at=null` | Not a missing sync (new row) but a missing human-close input: in write mode the first event on that job recomputes it to `confirmed` (no shifts, auto-complete off) or `completed` (auto-complete on and grace elapsed). API POST additionally writes no crew row. |
| 4 | `sweepArchivedClient` (row 45) | Cold-warm (client churn) | bulk `status=cancelled` | Same terminal-status reasoning as #2; missing audit rows per booking. |
| 5 | `resolveClientSkipAction` (row 44) and portal `requestSkipAction` (row 49) | Cold (portal is in a one-client pilot) | `status=cancelled` | Same as #2. The portal one is **client-initiated** with no booking audit row. |
| 6 | `claimOfferAction` (row 50) | Cold (bench offers; usage at Svit unknown) | `booking_assignees` insert / `membership_id` swap / delete | A real roster change (who the job waits on, window length under divide-hours) with no sync and no booking-level audit. Public token path. |
| 7 | `rederiveScheduledInstants` (row 58) | Nightly, but future rows only | `scheduled_at` | Audited. Only matters for an `in_progress` job whose `scheduled_at` is still in the future. |
| 8 | Org settings (rows 63-64) | Cold | `booking_auto_complete_hours`, `divide_crew_hours`, `auto_complete_past_bookings` | Changes every open job's `closesAtMs`/`windowEndMs`; the 30-min heartbeat (open jobs started within 3 days) is the only catch-up. |
| 9 | API DELETE / `deleteBookingAction` / `skipBookingOccurrenceAction` (rows 27, 28, 53) | Warm (deletes), cold (API) | row removed; `time_entries.booking_id → NULL` | Nothing to recompute, but hours silently become off-job entries with no audit row for the delete (rows 27, 53). |
| 10 | Direct PostgREST writes (rows 77-79) | Cold | anything the policy allows | Requires deliberate bypass; crew can flip `status` directly with no sync, no audit, no `closed_at`. |
| 11 | Scripts / purge (rows 66-69) | Cold | everything | Dev/ops only. |

Writers that DO recompute but write a status the rules may disagree with (not "no sync", but worth knowing): row 7 `completeJobAction` (`completed` with no `closed_at`), row 55 nightly sweep (`completed` with no `closed_at`, no audit row), row 1 `startJobAction` (`in_progress` before sync — agrees once the entry exists).

## 3. Writers that could recompute the wrong booking

- **`updateBookingAction`** (`src/app/app/bookings/actions.ts:1369`, `:1526`, `:2224`): `existing` is fetched through RLS with no null check, and the UPDATE is `.eq("id", id)` with no org filter and no row-count check. A foreign/nonexistent id yields a silent 0-row update, the crew rebuild deletes nothing, and `syncJob(id, "edit_form")` then runs on the admin client against whatever booking that id names in another org. Shadow mode writes a `state_check` row under that org; write mode would store that org's own derived status (correct for that org, but triggered cross-tenant).
- **`rescheduleBookingAction`** (`scheduling/actions.ts:286`): UPDATE is `.eq("id", id)` with no org filter and no row-count check, but `current` (L103-113) is RLS-fetched and null-checked first, so a foreign id stops at "Booking not found". Safe in practice.
- **`clockOutAtAction`** (`needs-you-actions.ts:148-150`): the only writer that explicitly checks the client-supplied `bookingId` against `entry.booking_id` before syncing. Correct.
- All `time_entries` writers in `timesheets/actions.ts` and `field/clock/actions.ts` sync the booking id read from the entry row (or validated in-org), not the client's.
- `restoreSeriesTimesAction` syncs ids computed server-side from `collectSeriesDrift`.
- API PATCH uses `.single()` on an org-filtered update, so a foreign id 500s before `syncJob`.
- `closeJob`, `setBookingStatusAction`, `removeMemberAction`, `assignBookingCrewAction`, `startJobAction`, `completeJobAction`, `dropShift` all fetch the booking with an org filter or RLS and bail on null before any sync.

No writer syncs a *different* booking than the one it wrote; the only slip is the cross-org no-op case in `updateBookingAction` above.
