# Finishing Sollos for Svit — the operating plan (v3, 2026-10-28)

## The goal, in Brian's words

Everything already built comes to 100% working. No new features. Things stop breaking.

That is a stabilization program, and it has three parts that run in this order:

1. **See the breakage.** Until errors reach you, "things keep breaking" is a feeling,
   not a list. Sentry readable with an alert on new field issues, the 8 AM morning
   check as a cron email, CI green on green. Evening 1.
2. **Walk everything once.** docs/feature-matrix.md lists every surface that exists
   (about 220 rows: 107 manager pages, 14 field screens, 8 portal pages, 50 API
   routes, 39 crons) tiered by what Svit actually uses. Tier A is a third of it.
   Each row is exercised once in production in the test org, on the device it is used
   from, and marked Pass or Fail with a feedback item. Fails are the backlog. Nothing
   is "working" until its row says Pass.
3. **Make it stay fixed.** Every Fail gets a test when it is fixed. The seam tests and
   the scripted day run in CI. The four pattern sweeps that found this week's bug
   classes in the job lifecycle (docs/maps/) are run on the money paths and the manager
   actions next, so the same shapes are found before a cleaner finds them.

Tier C (contracts, packages, inventory, bonuses, hiring, network, API keys, webhooks,
Square, QuickBooks, Sage) is verified last, and the honest option for most of it is to
hide it per org until someone asks, which shrinks what can break.

The job-lifecycle work below is the first Tier A block, because it is what broke this
week. It is not the whole program.

## The diagnosis in three lines

- The rules are solid: 795 tests pass, and the shadow rules have disagreed with
  production zero times in the last 36 hours.
- The bugs this week were all in the seams around the rules (writers that never told
  the rules, reads through the wrong client, failed reads treated as empty, two systems
  answering one question, time zones). Those are auditable patterns, not surprises.
- The real gap is that work lands at 80%: the job-state rules have sat in shadow with
  no exit date, the morning check was committed but its 8 AM task never created, the
  help articles do not mention "I'm here / I'm done" or Needs-you, the Friday changelog
  missed Oct 23, Sentry is not readable, the feedback board has two items. Each one is
  a thing a pro finishes before calling the feature done.

## Definition of done — nothing is shipped until every line is true

Paste this into every finishing commit's plan. A feature that cannot pass all ten is
not finished; it is in progress.

1. Code merged with a unit test for every pure decision it makes.
2. Migration applied in production **before** the push, and noted in the commit body.
3. Env vars and flags set in Vercel, documented in `src/lib/env.ts`.
4. Any cron or scheduled task it depends on is registered **and has been seen to run
   once** (check the log, the audit row, or the email).
5. Help article updated in the same commit; the assistant reads them at request time.
6. Pushed, and the deployment built the pushed SHA (`vercel ls cleanops --prod`), with
   `X-Vercel-Id` showing `pdx1`.
7. Done once for real in production, in the test org, on a phone where it is a field
   feature.
8. The next morning's check is clean.
9. An entry in Friday's changelog.
10. If it replaced something, the old path is deleted and the flag is gone. Nothing
    lives in shadow or behind a flag for more than seven days.

## One-time setup — one evening, Thu Oct 29

- First fix or delete `scripts/validate-cron-schedules.ts`: it still enforces the
  Hobby-plan ban on sub-daily crons, so the CI guard has failed on every push to main
  (verified Oct 28; unit tests pass). Then branch protection on `main` requiring the
  CI "Unit tests" job, and `tsc --noEmit` added to `.github/workflows/ci-guards.yml`.
  Today a red run still deploys.
- Sentry: a token that can read issues, an email alert on any new issue under `/field`,
  and a look at the last 14 days.
- Morning check as a Vercel cron that emails the five answers at 8 AM Edmonton
  (`scripts/shadow-morning-check.ts` already computes them). Desktop scheduled tasks
  only run when the app is open; that is why the changelog missed last Friday.
- Delete the `dev` branch (local and origin) so there is one line of work. Remove the
  stale worktree under `.claude/worktrees/`.
- Help articles for the new field taps and the Needs-you list; fix the "Clock in"
  wording in the timesheets guide.

## The finish list, in order, with exit criteria

Work one slice at a time to all ten lines of done before starting the next. Dates
assume evenings only.

| # | Slice | Done when | Target |
| --- | --- | --- | --- |
| 1 | Writer audit: every path that changes a booking's status, time, crew or a shift calls `syncJob` (13 do today) | A test fails if a writer module does not recompute | Fri Oct 30 |
| 2 | Client audit: decisions about other people read through the admin client (5 action files read `time_entries` through the caller) | Grep clean + the RLS test in slice 5 | Fri Oct 30 |
| 3 | Fail-closed audit across the 38 crons and the Needs-you loader | No query whose empty result sends, marks sent, or changes status can swallow an error | Sat Oct 31 |
| 4 | One message per fact: one dedupe key per (event, booking, person) | A test proves one tick cannot send two messages to one person about one job | Sat Oct 31 |
| — | **Nov 1 weekend: ship nothing.** First weekend under Alberta's permanent UTC-6; the rederive cron, series-drift list and generator guard fire for real. Watch, don't change. | Morning checks Nov 1–2 clean | Sun Nov 1 |
| 5 | Seam tests against a real Postgres with RLS on, signed in as a cleaner: A taps done while B is on the clock; last finisher closes; no-show after the window; job moved after a nudge; tap replayed from the phone queue; crew removed; split shift; office close with a running clock; API PATCH to completed; decline | Ten scenarios green in CI | Wed Nov 4 |
| 6 | A scripted day: seed one org, five jobs, six cleaners, play the taps, assert every state and notification | Runs in CI and before each push | Thu Nov 5 |
| 7 | Shadow exit review: replay from Aug 1 clean, seven shadow days with zero honoured disagreements, every unaided one explained | Written list of the unaided cases and why a person had to step in | Fri Nov 6 |
| 8 | **Cutover in one deploy**: `JOB_STATE_WRITE=1` **and** the nightly sweep's own status write deleted together (in write mode the sweep completes and invoices a job, then its recompute reverts it to confirmed; see docs/job-lifecycle-map.md §4); `vercel rollback` is the way back | Monday morning check clean, then delete the remaining old status writers and the flag | Sat Nov 7 → Tue Nov 10 |
| 9 | September sweep Tier 1 money list re-verified against current code; close what is still open | Each of the nine marked fixed / still open with a commit | Fri Nov 13 |
| 10 | Half-shipped inventory (below) cleared or explicitly dropped | Every row has a decision | Fri Nov 13 |
| 11 | Walk the "finished" list with Svitlana, item by item | She signs off a list, not a feeling | Sat Nov 14 |

## Half-shipped inventory (from memory and today's checks)

- Cleaner clock-ins never carry the phone's tap time: the Sep 13 insert-guard trigger
  rewrites `clock_in_at` to the server clock for non-managers (verified). Fix on
  evening 1; see docs/job-lifecycle-map.md §2.
- The full ranked list and the day-by-day order now live in docs/job-lifecycle-map.md §6.

- Job-state rules in shadow with no exit date → slice 7–8.
- Morning-check task never registered; `reports/` empty → setup evening.
- Help articles missing the new taps and Needs-you → setup evening.
- Friday changelog missed Oct 23 → run Oct 30 with the app open; move it to a cron.
- Feedback board: 2 items since Sep 3 → slice 11 puts her list on it.
- Sentry unreadable from here → setup evening.
- Square: dashboard checklist still owed (key non-empty, subscription URL + events).
- QuickBooks: production key switch is Brian's step; sandbox-verified Sep 5.
- Checklist at the property level: wired nowhere; apply or drop.
- Integration disconnect silent failure: deferred until Intuit + Google compliance.
- 1000-row pagination and the ~390-id `.in()` cliff: run machines refuse, reads
  still truncate silently; pay_type has no writer.
- Security Batch B/C and the small LOWs from September.

## The routine

**Evening (work session).** Pick the next slice. Before pushing: `pnpm test`, migration
applied, env set. Push once. After pushing: provenance check, `pdx1` header, do the
thing once in the test org. Write the help text while it is fresh.

**Morning (two minutes).** Read the 8 AM email. Any disagreement, any duplicate message,
anyone on the clock overnight gets a ticket before anything new.

**Friday.** Changelog goes out. The finish list table above gets its dates moved, not
its rows deleted.

**Saturday morning.** The only time for a cutover or a flag flip: fewest jobs, a full
day to watch, and Monday's check as the verdict.

**With Svitlana.** Once, this week: thirty minutes where her list of "finished" is typed
into the feedback board in front of her, each item done / not / needs her answer. Then
she gets Friday's email and the Nov 14 walk-through. Tell her the rules are being
watched in shadow and that Nov 7 is the switch.

## Rules that keep the known failures from coming back

- A query that selects without `.limit()` or chunks over ~390 ids is a bug on sight.
- A server action that decides anything about the crew from the caller's client is a
  bug on sight.
- A booking writer without `syncJob` is a bug on sight.
- Anything that formats an Edmonton time must be checked on a machine with current
  tzdata, including Brian's laptop (2025c today).
- Nothing operational depends on the desktop app being open.
- Two systems answering one question is itself the bug; the second one gets a
  deletion date the day it is born.
