/**
 * The one-line description a client reads on an invoice for a job.
 *
 * invoice_line_items has a single `label` column — no separate description —
 * and both the public invoice page and the PDF render it verbatim. So this
 * string IS the record of what was billed, and it has to stand on its own
 * months later when someone queries a charge.
 *
 * Auto-drafted invoices used to say only "Standard clean — 4033 32 St NW":
 * no date, no time. A client with weekly cleans got a stack of identical
 * lines and no way to tell which visit was which.
 *
 * Always formatted in the ORG's timezone. The billing-cycle cron previously
 * hardcoded UTC, which silently moved any late-afternoon Alberta job onto the
 * following day's date.
 */

function fmt(
  iso: string,
  tz: string,
  opts: Intl.DateTimeFormatOptions,
): string | null {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts }).format(
      new Date(iso),
    );
  } catch {
    return null;
  }
}

export function bookingLineLabel({
  serviceLabel,
  scheduledAt,
  durationMinutes,
  address,
  fallbackAddress,
  tz,
}: {
  /** service_type_label, or a humanized service_type. */
  serviceLabel: string;
  scheduledAt: string | null;
  durationMinutes: number | null;
  /** The booking's own address. */
  address: string | null;
  /**
   * The client's address on file, used when the booking carries none. The
   * field job card has always fallen back this way (`b.address ??
   * b.client?.address`); invoices did not, so a booking created without a
   * snapshotted address billed as "on site" even when the client's profile
   * held a full street address.
   */
  fallbackAddress?: string | null;
  /** IANA zone, e.g. "America/Edmonton". */
  tz: string;
}): string {
  const parts: string[] = [serviceLabel.trim() || "Service"];

  const startMs = scheduledAt ? new Date(scheduledAt).getTime() : NaN;
  if (Number.isFinite(startMs)) {
    const date = fmt(scheduledAt!, tz, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const start = fmt(scheduledAt!, tz, {
      hour: "numeric",
      minute: "2-digit",
    });

    // End time is derived, so a DST transition inside the job is handled by
    // Intl rather than by adding hours to a wall-clock string.
    let when = date ?? "";
    if (start) {
      const end =
        durationMinutes && durationMinutes > 0
          ? fmt(
              new Date(startMs + durationMinutes * 60_000).toISOString(),
              tz,
              {
                hour: "numeric",
                minute: "2-digit",
              },
            )
          : null;
      when = when ? `${when}, ${start}` : start;
      if (end) when += `–${end}`;
    }
    if (when) parts.push(when);
  }

  // Omitted entirely when absent — the old "on site" placeholder told a
  // client nothing they didn't already know.
  const addr = address?.trim() || fallbackAddress?.trim();
  if (addr) parts.push(addr);

  return parts.join(" · ");
}
