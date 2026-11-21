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
 *
 * The DATE, and no time of day (2026-11-21, Svitlana: "is it possible not to
 * show hours worked / scheduled on the invoice? When a few people are working
 * on that job, it's not accurate"). The line used to carry "9:30 AM–7:30 PM":
 * the start plus the booked length. The booked length is the hours for ONE
 * person, so a ten-hour job done by three people in an afternoon was billed
 * to the client as a ten-hour visit. A money document can't carry a time
 * range nobody worked, and the date alone already tells one visit from
 * another. matchLineToJob (lib/billed-bookings.ts) reads only the date.
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
  address,
  fallbackAddress,
  propertyLabel,
  tz,
}: {
  /** service_type_label, or a humanized service_type. */
  serviceLabel: string;
  scheduledAt: string | null;
  /** No longer printed: see the note above. Kept so callers needn't change. */
  durationMinutes?: number | null;
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
  /**
   * The property's name, when the job was at one of a client's several
   * places. An Airbnb host paying for four units needs to see WHICH unit on
   * every line — an address alone forces them to remember which street is
   * which, and "Standard clean — Aug 3" four times is unreadable.
   */
  propertyLabel?: string | null;
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
    if (date) parts.push(date);
  }

  // Omitted entirely when absent — the old "on site" placeholder told a
  // client nothing they didn't already know.
  // Property name before the address: it is the part a client recognises.
  // Both, not one — the name identifies the unit and the address proves it,
  // and an invoice line has to stand alone months later.
  const name = propertyLabel?.trim();
  if (name) parts.push(name);

  const addr = address?.trim() || fallbackAddress?.trim();
  if (addr) parts.push(addr);

  return parts.join(" · ");
}
