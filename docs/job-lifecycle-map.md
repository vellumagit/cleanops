# Sollos job lifecycle — what touches what, and where to start (2026-10-28)

Built from four read-only sweeps of the code at `b9075e4` (full tables in
`docs/maps/`: writers, readers, crons, half-shipped) plus the checks I ran myself,
marked **verified**. Nothing here was fixed; this is the map.

## 1. The spine

```
                 cleaners' taps            managers' forms           public API      crons
          (field/jobs/actions.ts,    (bookings/actions.ts 3,870 ln,  (api/v1)   (39 routes →
           field/clock/actions.ts)    scheduling, timesheets,                    automations.ts
                    │                 needs-you-actions)                 │         8,109 ln)
                    ▼                        ▼                           ▼            ▼
        ┌──────────────────────────────────────────────────────────────────────────────┐
        │  THE FACTS   bookings(status, scheduled_at, duration, closed_at, divide)     │
        │              booking_assignees(who is rostered, split_*)                     │
        │              time_entries(clock_in_at, clock_out_at, booking_id)             │
        │              organizations(auto-complete hours, divide-crew-hours, tz)       │
        └──────────────────────────────────────────────────────────────────────────────┘
                                           │ read by load() in job-sync.ts (admin client)
                                           ▼
                        src/lib/job-state.ts  deriveJobState()  ← pure, tested
                                           │
               ┌───────────────────────────┼─────────────────────────────┐
               ▼                           ▼                             ▼
      syncJob / syncLiveJobs        needs-you-items.ts (pure)       job page one-liner
      (shadow today: audit row      → needs-you.ts loader            + timeline
       "state_check"; write mode:   → needs-you-alerts.ts (push/email)
       bookings.status)             → dashboard buttons
```

- **79 writers** change the facts. 13 call `syncJob`; the rest are new rows, deletes,
  or the gaps listed in §2.
- **Two systems still write `bookings.status`**: the old paths (nightly sweep,
  `completeJobAction`, `startJobAction`, status actions) and, once `JOB_STATE_WRITE=1`,
  the rules. Until cutover the rules only write audit rows.
- `src/lib/automations.ts` (8,109 lines, 44 exports, most-changed file of the last 60
  days) is where the sweep, the job watcher, the clock-out cap, the chase, series
  extension and most senders live. It is the file every slice below touches.

## 2. Writers (docs/maps/map-writers.md, 79 rows)

What the state reads, exactly: bookings `status, scheduled_at, duration_minutes,
closed_at, divide_hours_evenly, total_cents, hourly_rate_cents, is_free`;
booking_assignees row existence + `split_*`; time_entries `clock_in_at, clock_out_at,
booking_id`; org auto-complete and divide settings. `completed_at` on the assignee row
is NOT a rules input (only `crew-completion.ts` reads it).

**Writers that change a fact and never recompute**, ranked by how often Svit hits them:

| Rank | Writer | What changes without the rules hearing |
| --- | --- | --- |
| 1 | Edit form / quick-assign "this and future" propagation (`bookings/actions.ts:2058`, `:3694`) | duration and crew on every future sibling; only the edited id is synced; no audit rows for siblings |
| 2 | `cancelSeriesAction` (`bookings/actions.ts:3381`) | status=cancelled on every future row; no sync, no audit, **no role gate** (any crew member of a row can call it) |
| 3 | `createBookingAction` and API POST with status=completed (`:741`, `api/v1/bookings/route.ts:209`) | completed with no `closed_at`; API POST also writes **no crew row**, so the rules see an empty crew |
| 4 | `sweepArchivedClient`, `resolveClientSkipAction`, portal `requestSkipAction` | status=cancelled, no sync, no booking audit (portal one is client-initiated) |
| 5 | `claimOfferAction` (`claim/[token]/actions.ts:279-332`) | roster insert / swap / delete from a public token link; no sync, no booking audit |
| 6 | Org settings (auto-complete hours, divide-crew-hours) | every open job's window moves; only the 30-minute heartbeat catches up |
| 7 | Deletes (`deleteBookingAction`, skip occurrence, API DELETE) | hours become unattached (`time_entries.booking_id` → null) silently; two of three have no audit |
| 8 | Direct PostgREST (policy "managers or crew update bookings") | a cleaner's browser can set `status` with no sync and no audit |

Also: `updateBookingAction` fetches `existing` with no null check and updates by id with
no org filter, so a foreign id is a silent no-op followed by `syncJob` on another org's
booking. And `completeJobAction` and the nightly sweep both write `completed` **without
`closed_at`**, so in write mode the rules may disagree with what they just stored.

**Verified by me — the clock-in time is never the tap time for cleaners.** Both cleaner
clock-in inserts (`field/jobs/actions.ts:275,295`, `field/clock/actions.ts:92`) go
through the caller's RLS client. The Sep 13 insider-guard trigger
`time_entries_employee_insert_guard` (`supabase/migrations/20260913030000:26-68`)
rewrites `clock_in_at := now()` for anyone who is not owner/admin/manager. So since
"I'm here" shipped on Oct 27, a queued or slow tap records the server's time, not hers;
an offline tap flushed an hour later marks her an hour late. Clock-out is an UPDATE and
keeps the tap time, which is why the Oct 28 clamp "clock-out never before clock-in" was
needed. Managers are exempt, so testing from your account looks right.

## 3. Readers (docs/maps/map-readers.md)

Policy summary that matters: an employee can SELECT only her own `time_entries`, can
SELECT every `booking_assignees` row in her org but write none, can UPDATE a booking
she is crew on (status and notes only, via trigger), and has no UPDATE policy at all
on `memberships`.

**Verdict: no cleaner-reachable crew decision still reads through the RLS client.**
`completeJobAction` now reads through `loadJobState` (admin) and every employee write
to `booking_assignees` goes through admin. This week's two fixes closed the class.

Residuals, hottest first:
1. `acceptGpsConsentAction` (`field/jobs/actions.ts:613`) updates `memberships` through
   the user client; no employee UPDATE policy exists, so it is a zero-row "success".
   Dormant only because the banner is not mounted.
2. The clock-in trigger above (same path, inverse shape: a write rewritten, not filtered).
3. `acceptShiftAction` (`field/jobs/actions.ts:700-787`): admin reads on a
   caller-supplied booking id with no check that she is on it; the `after()` block
   emails **that booking's org's** managers "X accepted". A forged id reaches another
   tenant's inbox.
4. `api/ai-chat/route.ts:80-87`: picks a membership by profile with no org and no
   active-org cookie; two active memberships → multi-row error → "Not available". That
   is why the assistant refuses you.

## 4. Crons and senders (docs/maps/map-crons.md, all 39 routes)

Every route fails closed on auth. The patterns that are still open, by frequency:

**Every 30 minutes**
- **Verified:** `needs-you-alerts.ts:52` reads the `needs_you_state` dedupe set with
  `{ data }` only; a failed read looks like "nothing sent" and every urgent alert
  (manager email + push, cleaner tell, night-before digest) re-sends that tick. Its
  `.in(keys)` is unchunked. Same class as this week's three fixes, one file over.
- `booking-coverage.ts:116-180`: all four reads log-and-continue with empty data →
  every booking looks unstaffed. Feeds unfilled-shifts pushes (and their 24 h dedupe
  then hides the real alert), unassigned-bookings emails, the sweep's "never staffed"
  mail and the weekly digest.
- Mark-after-send: job-watch no-clock-in email, chase reminders, clock-out nag.
- Duplicate pairs with no shared key: assignment push ↔ chase; chase ↔ late-start nudge.

**Hourly**: `notifyUpcomingJobs` dedupe read fail-open (`automations.ts:665`) and a
cross-org 2 h scan capped at 500; `runInvoiceAutoSend` puts every due invoice on hold
after one failed org read (`invoice-send.ts:546`).

**Daily**: the 2 AM sweep discards the open-shift read error (`automations.ts:7373`) and
can complete and invoice a job with someone on the clock; its three watchdog emails
have no dedupe and repeat nightly; `compute-bonuses` re-awards money if the existing
read fails (`:4395`, no unique index); the member-calendar reconcile deletes every
in-window event when its target read fails (`google-calendar.ts:2363-2385`);
`gcal-prune` deletes live events on a partial read (`:737-754`); payroll drafts price
capped shifts when the needs-review count read fails (`payroll-run-create.ts:73`).

**Verified — the cutover hazard.** The sweep completes a job when `scheduled_at <
now − H` (measured from the start); the rules complete it at `windowEnd + H` (from the
end). In write mode the sweep sets completed, drafts the invoice, then calls `syncJob`,
which computes confirmed and writes it: a confirmed job with a drafted invoice until the
next heartbeat. The sweep's status write must be deleted **in the same deploy** as the
flag flip, not after the Monday check.

Three messages per unstaffed job (22:00 email, 18:00-local digest, 08:00 push), three
independent dedupes. Routes with no `maxDuration` run partially on timeout with no
record of where they stopped: unfilled-shifts, upcoming-jobs, stale-estimates,
extend-series, compute-bonuses, payroll-autodraft, cleanup, trial-expiring.

## 5. Half-shipped (docs/maps/map-half-shipped.md)

**Verified:** CI has failed on every push to main today. Only "Validate Vercel cron
schedules" fails: `scripts/validate-cron-schedules.ts` still enforces the Hobby-plan
ban on sub-daily crons while `vercel.json` has hourly and 30-minute ones that run fine
in production. Unit tests pass. A permanently red check is why nobody looks at CI, and
branch protection would block every push until this is fixed.

Top of the ranked list (daily visibility):
1. Help articles describe dead buttons and omit I'm here / I'm done / Needs you; the
   assistant repeats them (`timesheets-and-payroll.ts:2-12`, `getting-around.ts:5,24`).
2. Job state in shadow, two systems writing status (§1, §4).
3. Inbound SMS drops every real client reply (`api/sms/inbound/route.ts:103-106`).
4. Morning check never scheduled; `reports/` never written.
5. Settings → Webhooks offers events the UI never fires; `invoice.sent` cannot fire.
6. `pay_type` has a CHECK constraint, a help paragraph and no writer; timesheets
   hardcodes hourly.
7. Property-level default checklist is saved and never applied (`checklistTemplateFor`
   has zero callers).
8. Twilio simulated numbers persist after go-live; the settings copy promises an
   upgrade that is not implemented.
9. The CI guard above.
10. `ai_conversations` write-only.
Then: billing "scaffolded" banner visible to owners; seven "column not in generated
types" second queries (`pnpm db:types` never re-run); one-off migration scripts and an
on-disk export of the old project including auth users; stale worktree and dead
exports; the two most consequential untested files are `job-sync.ts` and `needs-you.ts`,
and all 60 `actions.ts` files (22k lines) have no tests. Three migration files are dated
Oct 29–30 although they shipped Oct 27–28; a migration created today with a true
timestamp sorts before them.

## 6. Where to start

The order is by what a cleaner or Svitlana feels today, then by what guards the Nov 7
cutover. Each is one evening or less.

**Evening 1 (Thu Oct 29) — make the signals honest, fix the hottest path**
1. Fix or delete the cron-schedule guard so CI is green on green. Then branch
   protection on main requiring the unit-tests job, plus `tsc --noEmit`.
2. Clock-in tap time: validate `punchedAt` server-side (punch-time.ts already bounds
   it to 12 h back / 5 min forward), then insert through the admin client so the
   trigger's rewrite does not apply. Keep the trigger: it still guards direct PostgREST
   inserts. Add the test "a tap queued at 9:00 and sent at 10:00 records 9:00 for an
   employee".
3. `needs-you-alerts.ts:52`: throw on error, chunk the `.in`. Same for the other
   dedupe reads at `automations.ts:665`, `unfilled-shifts:67`, `stale-estimates:895`.
4. Morning check as a Vercel cron that emails you at 8 AM Edmonton.
5. Help: a field-app article (I'm here, I'm done, Clock, Hours, Pay) and a Needs-you
   section; fix the dead button names.

**Evening 2 (Fri Oct 30) — writers, the ranked list in §2**
6. `cancelSeriesAction`: role gate, per-row sync and audit.
7. `this_and_future` propagation: sync every sibling it touched (or skip
   `in_progress` siblings explicitly) and audit them.
8. `createBookingAction` / API POST / sweep / `completeJobAction`: writing `completed`
   sets `closed_at`; API POST writes the crew row for `assigned_to`.
9. `claimOfferAction`: `syncJob` after the roster change, audit on the booking.
10. `updateBookingAction`: null-check `existing`, org-filter the update.
11. `acceptShiftAction`: require the caller's own assignee row before any read.
12. A test that imports each writer module and asserts it recomputes.

**Sat Oct 31 — fail closed and one message per fact**
13. `booking-coverage.ts`: throw; the four callers skip the org and say so.
14. Sweep `:7373` open-shift read: fatal for the run. `compute-bonuses :4395`: fatal.
    Calendar reconcile and prune: abort the delete pass on any failed read.
15. Mark-before-send where a stamp exists; a dedupe key for the three unstaffed-job
    messages and for assignment↔chase.
16. `maxDuration` on the eight routes without one.

**Sun Nov 1 — ship nothing.** Watch the Alberta weekend.

**Nov 2–6 — tests on the seams, then the cutover review**
17. Seam tests against a real Postgres with RLS on, as a cleaner (ten scenarios in the
    finish plan), plus the scripted day. Priority modules: `job-sync.ts`, `needs-you.ts`.
18. Shadow exit review with the replay harness.

**Sat Nov 7 — cutover in one deploy**: `JOB_STATE_WRITE=1`, delete the sweep's status
write, delete `completeJobAction`'s and `startJobAction`'s direct status writes (the
rules own status), keep `closeJob` as the human "it's over" input.

**Decisions only you can make (file on the feedback board with Svitlana where they
touch her):** pay_type (wire or drop), property-level checklist (apply or drop), inbound
SMS replies (store and show, or stop promising), outgoing webhooks from the UI (dispatch
or remove the options), Twilio simulated numbers, the billing banner, QuickBooks
production keys, Square dashboard checklist.
