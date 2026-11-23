import { loadOpenTimes } from "@/lib/open-times-load";
import { noTimesSentence } from "@/lib/open-times";
import { timeLabel } from "@/lib/availability-week";
import { formatDurationMinutes } from "@/lib/format";

/**
 * "What a visitor would see": the open times for one service over a week,
 * worked out from the real schedule. For the office only, on the settings
 * page, so the owner can hold it against the calendar they know before any
 * of it is offered to the public (roadmap phase 2).
 *
 * A plain GET form: the service and the first day are in the address, so a
 * week can be bookmarked or sent to someone in the office.
 */
export async function OpenTimesPreview({
  organizationId,
  services,
  serviceId,
  fromYmd,
}: {
  organizationId: string;
  services: Array<{ id: string; name: string; minutes: number | null }>;
  serviceId: string | null;
  fromYmd: string | null;
}) {
  const chosen = services.find((s) => s.id === serviceId) ?? services.find((s) => (s.minutes ?? 0) > 0) ?? services[0] ?? null;

  let loaded: Awaited<ReturnType<typeof loadOpenTimes>> | null = null;
  let failed = false;
  if (chosen) {
    try {
      loaded = await loadOpenTimes({ organizationId, serviceId: chosen.id, fromYmd: fromYmd ?? undefined, days: 7 });
    } catch (err) {
      console.error("[online-booking] preview failed:", err);
      failed = true;
    }
  }
  const dayLabel = (ymd: string) =>
    new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric" });

  return (
    <section id="preview" className="space-y-4 rounded-lg border border-border bg-card p-5" aria-labelledby="preview-heading">
      <div>
        <h2 id="preview-heading" className="text-base font-semibold">
          What a visitor would see
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          The open times for one service over seven days, from your real schedule. Only you can see this. Check it
          against your calendar: every time listed is one you&rsquo;d be happy to be booked for.
        </p>
      </div>

      {services.length === 0 ? (
        <p className="text-sm text-muted-foreground">You have no services yet. Add them in Settings, Services.</p>
      ) : (
        <form method="get" action="/app/settings/online-booking#preview" className="flex flex-wrap items-end gap-3">
          <label className="min-w-0 flex-1 space-y-1">
            <span className="block text-sm font-medium">Service</span>
            <select
              id="preview-service"
              name="service"
              defaultValue={chosen?.id}
              className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"
            >
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {(s.minutes ?? 0) > 0 ? ` (${formatDurationMinutes(s.minutes as number)})` : " (no length set)"}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-sm font-medium">From</span>
            <input
              id="preview-from"
              type="date"
              name="from"
              defaultValue={loaded?.ok ? loaded.days[0]?.ymd : (fromYmd ?? undefined)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            />
          </label>
          <button type="submit" className="h-9 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted">
            Show
          </button>
        </form>
      )}

      {failed && <p className="text-sm text-destructive">The open times couldn&rsquo;t be worked out just now. Reload the page.</p>}
      {loaded && !loaded.ok && <p className="text-sm text-muted-foreground">{loaded.error}</p>}

      {loaded?.ok && (
        <>
          <p className="text-xs text-muted-foreground" data-testid="preview-summary">
            {loaded.service.name}: {formatDurationMinutes(loaded.service.minutes)} of work
            {loaded.service.crewSize > 1 ? `, ${loaded.service.crewSize} cleaners` : ", 1 cleaner"}.{" "}
            {loaded.cleaners.length === 0
              ? "Nobody is set to take online bookings."
              : `Taking online bookings: ${loaded.cleaners.map((c) => c.name).join(", ")}.`}
          </p>
          <ul className="divide-y divide-border rounded-md border border-border" data-testid="preview-days">
            {loaded.days.map((d) => (
              <li key={d.ymd} className="p-3" data-day={d.ymd}>
                <p className="text-sm font-medium">{dayLabel(d.ymd)}</p>
                {d.times.length === 0 ? (
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {d.holiday && d.reason === "closed" ? `Closed: ${d.holiday}.` : noTimesSentence(d.reason ?? "full")}
                  </p>
                ) : (
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {d.times.map((t) => (
                      <li
                        key={t.startMs}
                        className="rounded-md border border-border bg-background px-2 py-1 text-xs tabular-nums"
                        title={`Free: ${t.cleaners.map((id) => loaded.cleaners.find((c) => c.id === id)?.name ?? "someone").join(", ")}`}
                      >
                        {timeLabel(t.hhmm)}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
