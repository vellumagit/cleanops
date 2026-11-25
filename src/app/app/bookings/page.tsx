import Link from "next/link";
import { Plus, Repeat, Inbox } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { ArchivedToggle } from "@/components/archived-toggle";
import { memberDisplayName } from "@/lib/member-display";
import { getOrgTimezone } from "@/lib/org-timezone";
import { zonedDayBoundsUtc } from "@/lib/wall-clock";
import { orgDividesCrewHours } from "@/lib/crew-hours";
import { describeRecurrence } from "@/lib/recurrence";
import { getFlaggedCrewIds } from "@/lib/crew-accommodations";
import { resolveFreelancerCoverageNames } from "@/lib/booking-coverage";
import { selectInChunks } from "@/lib/supabase/chunked-in";
import { jobStillOpen } from "@/lib/crew-eligibility";
import { BookingsTable, type BookingRow } from "./bookings-table";
import { loadCoverNeeded } from "@/lib/cover-needed";
import { coverReason, coverSummary } from "@/lib/cover-needed-text";
import { PutOnAnywayButton } from "./put-on-anyway-button";
import { keptSentence } from "@/lib/series-hand-set";
import { bookingSearchOr, containsPattern } from "@/lib/booking-search";

export const metadata = { title: "Bookings" };

/** How many bookings the full list holds, newest first. The page says when there are more. */
const LIST_LIMIT = 1000;
/**
 * How many visits the Upcoming list holds, soonest first. Upcoming is what
 * opens by default, so it reads only from today on: the full list (Past,
 * All) is fetched when someone asks for it. Svit froze on this page on
 * 2026-11-21 with ~1,000 bookings sent and drawn on every visit.
 */
const UPCOMING_LIMIT = 500;

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string; client?: string; cover?: string; kept?: string; tab?: string; q?: string }>;
}) {
  const membership = await requireMembership();
  const canEdit = membership.role === "owner" || membership.role === "admin" || membership.role === "manager";
  const supabase = await createSupabaseServerClient();
  // Fired, not awaited — resolves while the main bookings query runs.
  const tzPromise = getOrgTimezone(membership.organization_id);
  // Same: the overlap warning needs to know whether a team job's hours split
  // across its crew, and that lives on the org rather than the booking.
  const dividesPromise = orgDividesCrewHours(membership.organization_id);
  const { archived, client, cover, kept, tab, q } = await searchParams;
  const showArchived = archived === "1";
  const clientFilter = client?.trim() || null;
  // Which rows to send. "upcoming" (the default tab, and Today) sends from the
  // start of today on. "all" (Past, All, one client's list, the archive)
  // sends the next UPCOMING_LIMIT visits AND the latest LIST_LIMIT before
  // today, fetched apart: one newest-first list of 1,000 was all future for
  // a company with a year of recurring visits booked, so Past had nothing
  // to show for a search (2026-11-25).
  //
  // A search no longer switches the scope by itself: the tabs apply to a
  // search like to anything else. The search itself runs here, on the
  // server, over everything in the scope (lib/booking-search.ts): Upcoming
  // holds only the next UPCOMING_LIMIT visits, and Svit has years of
  // recurring visits booked past that.
  const needle = (q ?? "").trim();
  const scope: "upcoming" | "all" =
    tab === "past" || tab === "all" || clientFilter || showArchived ? "all" : "upcoming";
  const todayStartIso = zonedDayBoundsUtc(new Date(), await tzPromise, 0).start.toISOString();

  const listQuery = (searchOr: string | null) => {
    let query = supabase
    .from("bookings")
    .select(
      `
        id,
        scheduled_at,
        duration_minutes,
        service_type,
        service_type_label,
        status,
        total_cents,
        hourly_rate_cents,
        series_id,
        address,
        notes,
        assigned_to,
        divide_hours_evenly,
        is_free,
        client:clients ( id, name, notes ),
        assigned:memberships!bookings_assigned_to_fkey (
          id,
          display_name,
          profile:profiles ( full_name )
        )
      `,
    );

    // Explicit org scope — a two-org admin reads both orgs via RLS alone.
    query = query.eq("organization_id", membership.organization_id);

    // ?client= — the client page's stat cards and "View all" promise this
    // scoping; the param was accepted and ignored for months.
    if (clientFilter) query = query.eq("client_id", clientFilter);

    // Default: hide auto-archived rows. When ?archived=1, show ONLY archived.
    query = showArchived
      ? query.not("archived_at" as never, "is" as never, null as never)
      : query.is("archived_at" as never, null as never);

    if (searchOr) query = query.or(searchOr);
    return query;
  };

  // Active employees for the org — feeds the per-row "Assign" popup.
  // Promise.resolve subscribes the lazy builder NOW so it runs in
  // parallel with the main query instead of after it.
  const employeesPromise = Promise.resolve(
    supabase
      .from("memberships")
      .select("id, display_name, profile:profiles ( full_name )")
      .eq("status", "active")
      .in("role", ["employee", "admin", "owner", "manager"])
      .order("display_name", { ascending: true }),
  ) as unknown as Promise<{
    data: Array<{
      id: string;
      display_name: string | null;
      profile: { full_name: string | null } | null;
    }> | null;
  }>;

  // The search: the clients and cleaners whose names match, then one
  // filter for the list and its count.
  const searchOrPromise: Promise<string | null> =
    needle
      ? (async () => {
          const lower = needle.toLowerCase();
          const [{ data: clientRows }, { data: people }] = await Promise.all([
            supabase
              .from("clients")
              .select("id")
              .eq("organization_id", membership.organization_id)
              .ilike("name", containsPattern(needle))
              .limit(500) as unknown as Promise<{ data: Array<{ id: string }> | null }>,
            employeesPromise,
          ]);
          return bookingSearchOr({
            needle,
            clientIds: (clientRows ?? []).map((c) => c.id),
            memberIds: (people ?? []).filter((m) => memberDisplayName(m).toLowerCase().includes(lower)).map((m) => m.id),
          });
        })()
      : Promise.resolve(null);

  // Everything below that does not need the list starts NOW, beside it.
  // This page used to ask its questions one at a time: the list, then a
  // count, then the accommodation flags, the crews, the coverage, the cover
  // warnings, the series count and the request count, each waiting for the
  // one before. Measured on the test stack (2026-11-21): twelve database
  // round trips end to end. Now: the list and these together, then one batch
  // keyed on the list, then the one lookup that needs that batch.
  //
  // The total is counted whether or not the list comes back full: a head
  // count is cheap, and Svit's list is at the limit (983 of 1,000 on
  // 2026-11-16), so waiting to find out cost a round trip on every visit.
  const totalPromise = searchOrPromise.then((searchOr) => {
    let counted = supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", membership.organization_id);
    if (clientFilter) counted = counted.eq("client_id", clientFilter);
    counted = showArchived
      ? counted.not("archived_at" as never, "is" as never, null as never)
      : counted.is("archived_at" as never, null as never);
    if (searchOr) counted = counted.or(searchOr);
    return counted;
  });
  const pastCountPromise =
    scope === "upcoming"
      ? (Promise.resolve(
          supabase
            .from("bookings")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", membership.organization_id)
            .is("archived_at" as never, null as never)
            .lt("scheduled_at", todayStartIso),
        ) as unknown as Promise<{ count: number | null }>)
      : Promise.resolve({ count: null as number | null });
  const flaggedCrewPromise = employeesPromise.then(({ data: employeesData }) =>
    getFlaggedCrewIds((employeesData ?? []).map((m) => m.id)),
  );
  // Count active series for this org
  const seriesCountPromise = Promise.resolve(
    supabase
      .from("booking_series" as never)
      .select("id", { count: "exact", head: true })
      .eq("active" as never, true as never),
  ) as unknown as Promise<{ count: number | null }>;
  // Pending client-submitted booking requests from the portal — surface
  // the count so the owner notices without having to navigate deeper.
  const pendingRequestPromise = Promise.resolve(
    supabase
      .from("booking_requests" as never)
      .select("id", { count: "exact", head: true })
      .eq("status" as never, "pending" as never),
  ) as unknown as Promise<{ count: number | null }>;
  // Visits a series' crew save left someone off (another job at that
  // time): the chip beside the row, and after such a save the banner that
  // says who and which dates. Read on its own so the list never depends on
  // it.
  const coverPromise = (async () => {
    const needsCover = new Map<string, string>();
    let coverBanner: string | null = null;
    // Was anyone left off for another job (not a last working day)? Then
    // the office may put them on anyway.
    let coverPutOn = false;
    try {
      const fromIso = new Date().toISOString();
      const [all, forSeries, tzForCover] = await Promise.all([
        loadCoverNeeded(membership.organization_id, { from: fromIso }),
        cover && /^[0-9a-f-]{36}$/i.test(cover)
          ? loadCoverNeeded(membership.organization_id, { seriesId: cover, from: fromIso })
          : Promise.resolve(null),
        tzPromise,
      ]);
      for (const v of all) needsCover.set(v.bookingId, coverReason(v, tzForCover));
      if (forSeries) {
        coverBanner = coverSummary(forSeries, tzForCover);
        coverPutOn = forSeries.some((v) => v.people.some((p) => p.finishedOn == null));
      }
    } catch (err) {
      console.error("[bookings] could not read which visits need cover:", err);
    }
    return { needsCover, coverBanner, coverPutOn };
  })();
  // After a series save that left some visits as the office had set them by
  // hand (series-hand-set.ts): say which, so they can be opened. The ids
  // come from the address, so they are read back through this company only.
  const keptPromise = (async (): Promise<string | null> => {
    const ids = String(kept ?? "")
      .split(",")
      .filter((v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v))
      .slice(0, 20);
    if (ids.length === 0) return null;
    try {
      const [{ data }, tzForKept] = await Promise.all([
        supabase
          .from("bookings")
          .select("scheduled_at")
          .eq("organization_id", membership.organization_id)
          .in("id", ids) as unknown as Promise<{ data: Array<{ scheduled_at: string }> | null }>,
        tzPromise,
      ]);
      return keptSentence((data ?? []).map((b) => ({ scheduledAt: b.scheduled_at })), tzForKept);
    } catch (err) {
      console.error("[bookings] could not read the visits a series save kept:", err);
      return null;
    }
  })();

  const searchOr = await searchOrPromise;
  const [aheadRes, behindRes] = await Promise.all([
    listQuery(searchOr)
      .gte("scheduled_at", todayStartIso)
      .order("scheduled_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(UPCOMING_LIMIT) as unknown as Promise<ListResult>,
    scope === "all"
      ? (listQuery(searchOr)
          .lt("scheduled_at", todayStartIso)
          .order("scheduled_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(LIST_LIMIT) as unknown as Promise<ListResult>)
      : Promise.resolve<ListResult>({ data: [], error: null }),
  ]);
  const error = aheadRes.error ?? behindRes.error;
  const aheadCapped = (aheadRes.data ?? []).length >= UPCOMING_LIMIT;
  const behindCapped = (behindRes.data ?? []).length >= LIST_LIMIT;
  const data = [...(behindRes.data ?? []), ...(aheadRes.data ?? [])];
  type ListResult = {
    data: Array<{
      id: string;
      scheduled_at: string;
      duration_minutes: number;
      service_type: string;
      service_type_label: string | null;
      status: string;
      total_cents: number;
      hourly_rate_cents: number | null;
      series_id: string | null;
      address: string | null;
      notes: string | null;
      assigned_to: string | null;
      client: { id: string; name: string; notes: string | null } | null;
      assigned: {
        id: string;
        display_name: string | null;
        profile: { full_name: string } | null;
      } | null;
    }> | null;
    error: { message: string } | null;
  };

  if (error) throw error;

  // The list stops at LIST_LIMIT, newest first. Past it the oldest jobs fell
  // off without a word, and searching the table for one found nothing (Svit
  // reached 983 bookings on 2026-11-16). When the list is full, count what
  // there is and say so above the table.
  const bookingIds = (data ?? []).map((b) => b.id);
  const seriesIds = [
    ...new Set((data ?? []).map((b) => b.series_id).filter(Boolean)),
  ] as string[];
  type SeriesRow = {
    id: string;
    pattern: string;
    custom_days: number[] | null;
    start_time: string;
    monthly_nth: number | null;
    monthly_dow: number | null;
  };

  // One batch for everything keyed on the list (see the note above).
  const [
    { data: employeesData },
    flaggedCrew,
    { data: seriesRows },
    { data: assigneesData },
    coverageMap,
    { count: totalCount },
    tz,
    orgDividesHours,
  ] = await Promise.all([
    employeesPromise,
    flaggedCrewPromise,
    // The repeat icon said "Recurring booking" and nothing else, so telling
    // every-4-weeks from monthly-on-a-Saturday meant opening the edit form.
    // One batch query for the series on this page turns the badge into the
    // actual rule.
    seriesIds.length
      ? (Promise.resolve(
          supabase
            .from("booking_series" as never)
            .select(
              "id, pattern, custom_days, start_time, monthly_nth, monthly_dow",
            )
            .in("id" as never, seriesIds as never),
        ) as unknown as Promise<{ data: SeriesRow[] | null }>)
      : Promise.resolve({ data: [] as SeriesRow[] }),
    // Junction rows for the bookings on this page — gives us each
    // booking's full additional crew so the Assign dialog opens with the
    // current selection pre-filled.
    // Chunked: up to 1,000 ids in one `in` filter overflowed the request URL
    // and the whole lookup failed, so every team job showed only its first
    // cleaner. See lib/supabase/chunked-in.ts.
    selectInChunks(bookingIds, (chunk) =>
      supabase
        .from("booking_assignees" as never)
        .select(
          "booking_id, membership_id, is_primary, split_start_offset_minutes, split_duration_minutes",
        )
        .in("booking_id" as never, chunk as never) as unknown as Promise<{
        data: Array<{
          booking_id: string;
          membership_id: string;
          is_primary: boolean;
          split_start_offset_minutes: number | null;
          split_duration_minutes: number | null;
        }> | null;
        error: { message: string } | null;
      }>,
    ),
    // Subcontractor coverage — who claimed a shift offer on each booking. Read
    // from the claims table, not job_offers.filled_*: a 1-of-N claim leaves the
    // offer 'open' and a later claim overwrites the single filled pointer, so
    // filtering on status='filled' hid real claimers. Shown alongside member
    // assignment, not just as its fallback — a lead cleaner plus a bench
    // freelancer is a real crew shape.
    resolveFreelancerCoverageNames(bookingIds),
    totalPromise,
    tzPromise,
    dividesPromise,
  ]);
  const { count: pastCount } = await pastCountPromise;
  // The full list stops at UPCOMING_LIMIT ahead and LIST_LIMIT behind; only
  // when one of them is full is the total worth saying.
  const total: number | null =
    scope === "all" && (aheadCapped || behindCapped) ? (totalCount ?? null) : null;
  const upcomingCapped = scope === "upcoming" && aheadCapped;

  const employees = (employeesData ?? []).map((m) => ({
    id: m.id,
    label: memberDisplayName(m) ?? "Unnamed",
    hasAccommodations: flaggedCrew.has(m.id),
  }));

  const seriesLabelById = new Map<string, string>();
  for (const s of seriesRows ?? []) {
    seriesLabelById.set(
      s.id,
      describeRecurrence(
        s.pattern as Parameters<typeof describeRecurrence>[0],
        s.custom_days,
        s.start_time,
        s.monthly_nth,
        s.monthly_dow,
      ),
    );
  }
  const additionalByBooking = new Map<string, string[]>();
  // Count split segments per booking (rows carrying split metadata). 2+
  // means the booking is a split shift — feeds the table's "Split" chip.
  const segmentCountByBooking = new Map<string, number>();
  for (const r of assigneesData ?? []) {
    if (!r.is_primary) {
      const arr = additionalByBooking.get(r.booking_id) ?? [];
      arr.push(r.membership_id);
      additionalByBooking.set(r.booking_id, arr);
    }
    if (
      r.split_start_offset_minutes != null &&
      r.split_duration_minutes != null
    ) {
      segmentCountByBooking.set(
        r.booking_id,
        (segmentCountByBooking.get(r.booking_id) ?? 0) + 1,
      );
    }
  }

  // People on these bookings who have been deactivated. The list showed
  // their name like anyone else's, so a job looked staffed by someone who
  // could not turn up (Svit, 2026-11-14: 52 upcoming visits of one series
  // led by a placeholder deactivated in May). Each such booking gets a
  // warning sign beside its crew; finished and cancelled jobs don't, since
  // there it is just history.
  const activeIds = new Set(employees.map((e) => e.id));
  const crewByBooking = new Map<string, Set<string>>();
  const onCrew = (bookingId: string, memberId: string | null) => {
    if (!memberId) return;
    const set = crewByBooking.get(bookingId) ?? new Set<string>();
    set.add(memberId);
    crewByBooking.set(bookingId, set);
  };
  for (const b of data ?? []) onCrew(b.id, b.assigned_to);
  for (const r of assigneesData ?? []) onCrew(r.booking_id, r.membership_id);
  const inactiveIds = [
    ...new Set([...crewByBooking.values()].flatMap((s) => [...s])),
  ].filter((mid) => !activeIds.has(mid));
  const inactiveNames = new Map<string, string>();
  if (inactiveIds.length > 0) {
    const { data: gone } = await selectInChunks(inactiveIds, (chunk) =>
      supabase
        .from("memberships")
        .select("id, display_name, profile:profiles ( full_name )")
        .eq("organization_id", membership.organization_id)
        .in("id", chunk) as unknown as Promise<{
        data: Array<{
          id: string;
          display_name: string | null;
          profile: { full_name: string | null } | null;
        }> | null;
        error: { message: string } | null;
      }>,
    );
    for (const m of gone ?? []) inactiveNames.set(m.id, memberDisplayName(m));
  }
  const inactiveCrewOf = (bookingId: string, status: string): string[] =>
    jobStillOpen(status)
      ? [...(crewByBooking.get(bookingId) ?? [])]
          .filter((mid) => inactiveNames.has(mid))
          .map((mid) => inactiveNames.get(mid) as string)
      : [];

  const [{ needsCover, coverBanner, coverPutOn }, { count: seriesCount }, { count: pendingRequestCount }, keptBanner] =
    await Promise.all([coverPromise, seriesCountPromise, pendingRequestPromise, keptPromise]);

  const rows: BookingRow[] = (data ?? []).map((b) => ({
    id: b.id,
    scheduled_at: b.scheduled_at,
    duration_minutes: b.duration_minutes,
    service_type: b.service_type,
    service_type_label: b.service_type_label ?? null,
    status: b.status as BookingRow["status"],
    total_cents: b.total_cents,
    client_id: b.client?.id ?? null,
    client_name: b.client?.name ?? "—",
    hourly_rate_cents: b.hourly_rate_cents ?? null,
    assigned_name: b.assigned ? memberDisplayName(b.assigned) : null,
    covered_by_name: coverageMap.get(b.id)?.join(", ") ?? null,
    assigned_to: b.assigned_to,
    inactive_crew_names: inactiveCrewOf(b.id, b.status),
    needs_cover: needsCover.get(b.id) ?? null,
    additional_assignee_ids: additionalByBooking.get(b.id) ?? [],
    // Per-booking flag wins when set; otherwise the org default. Matches
    // resolveTeamDivision, which is what the rest of the app divides by.
    divides_hours:
      (b as { divide_hours_evenly?: boolean | null }).divide_hours_evenly ===
      true
        ? true
        : orgDividesHours,
    is_free: (b as { is_free?: boolean | null }).is_free === true,
    segment_count: segmentCountByBooking.get(b.id) ?? 0,
    series_id: b.series_id ?? null,
    // Describes the SERIES RULE, which is not always what the bookings
    // actually do — Amanda DeGroot's row says every 4 weeks while her dates
    // run 2nd-Saturday monthly. Showing the rule is how you spot that.
    series_label: b.series_id
      ? (seriesLabelById.get(b.series_id) ?? null)
      : null,
    address: b.address ?? null,
    notes: b.notes ?? null,
    client_notes: b.client?.notes ?? null,
  }));

  return (
    <PageShell
      title={showArchived ? "Bookings — archived" : "Bookings"}
      description={
        showArchived
          ? "Jobs older than your archive threshold. Read-only snapshot."
          : "All cleaning jobs scheduled across your team."
      }
      actions={
        <div className="flex items-center gap-2">
          <ArchivedToggle
            basePath="/app/bookings"
            showingArchived={showArchived}
          />
          {canEdit && !showArchived && (
            <>
              {(pendingRequestCount ?? 0) > 0 && (
                <Link
                  href="/app/bookings/requests"
                  className={buttonVariants({ variant: "outline" })}
                >
                  <Inbox className="h-4 w-4" />
                  Requests ({pendingRequestCount})
                </Link>
              )}
              {(seriesCount ?? 0) > 0 && (
                <Link
                  href="/app/bookings/series"
                  className={buttonVariants({ variant: "outline" })}
                >
                  <Repeat className="h-4 w-4" />
                  Recurring ({seriesCount})
                </Link>
              )}
              <Link
                href="/app/bookings/new"
                className={buttonVariants({ variant: "default" })}
              >
                <Plus className="h-4 w-4" />
                New booking
              </Link>
            </>
          )}
        </div>
      }
    >
      {clientFilter && (
        <div className="mb-3 flex items-center gap-2 text-sm">
          <span className="rounded-full bg-primary/10 px-3 py-1 font-medium text-primary">
            Filtered to {rows[0]?.client_name ?? "one client"}
          </span>
          <Link
            href="/app/bookings"
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Show all bookings
          </Link>
        </div>
      )}
      {total != null && total > rows.length && (
        <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-800 dark:text-amber-300">
          Showing {rows.length.toLocaleString()} of {total.toLocaleString()} bookings
          {needle ? <> matching &ldquo;{needle}&rdquo;</> : null}:
          {behindCapped && aheadCapped
            ? " the latest past ones and the next upcoming ones."
            : behindCapped
              ? " the oldest aren't listed here."
              : " the furthest ahead aren't listed here."}{" "}
          {needle ? "Search for something narrower" : "Search, or open a client"} to see the rest.
        </p>
      )}
      {upcomingCapped && (
        <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-800 dark:text-amber-300">
          Showing the next {rows.length.toLocaleString()} upcoming visits. Later ones are on the All tab.
        </p>
      )}
      {keptBanner && (
        <p
          role="status"
          data-testid="kept-banner"
          className="mb-3 rounded-lg border border-sky-500/40 bg-sky-500/10 px-4 py-3 text-sm text-sky-900 dark:text-sky-200"
        >
          <span className="font-semibold">Series saved.</span> {keptBanner}
        </p>
      )}
      {coverBanner && (
        <p
          role="status"
          data-testid="cover-banner"
          className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200"
        >
          <span className="font-semibold">Series saved.</span> {coverBanner}
          {coverPutOn && cover && canEdit && (
            <span className="mt-2 flex flex-wrap items-center gap-2">
              <PutOnAnywayButton seriesId={cover} />
              <span className="text-xs">
                Keeps them on those visits, double-booked, so you can move each visit yourself.
              </span>
            </span>
          )}
        </p>
      )}
      <BookingsTable
        rows={rows}
        canEdit={canEdit && !showArchived}
        tz={tz}
        employees={employees}
        scope={scope}
        serverQuery={needle}
        serverCounts={
          scope === "upcoming"
            ? { past: pastCount ?? 0, all: totalCount ?? rows.length }
            : null
        }
      />
    </PageShell>
  );
}
