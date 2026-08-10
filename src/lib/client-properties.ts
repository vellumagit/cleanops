/**
 * One client, many places.
 *
 * A property is a physical location a client has cleaned — an Airbnb host's
 * four units, a landlord's duplexes, an office manager's two floors. Before
 * this existed a client WAS an address, so the only way to serve such a
 * customer was to create four fake clients and lose the single balance, the
 * single contact, and any hope of a per-property answer.
 *
 * Three separate questions get asked about a job's location and they have
 * three different answers. Every one of them is resolved here, because the
 * field app, the invoice, and the office screens must agree — a cleaner
 * driving to one address while the invoice bills another is the failure this
 * module exists to prevent.
 */

export type PropertyLike = {
  id?: string | null;
  label?: string | null;
  address?: string | null;
  access_notes?: string | null;
  default_checklist_template_id?: string | null;
};

/**
 * WHERE THE CLEANER GOES.
 *
 * Precedence, and the order is not arbitrary:
 *
 *   1. booking.address   the snapshot taken when this job was booked
 *   2. property.address  the property's current address
 *   3. client.address    the client's address on file
 *
 * The booking's own snapshot wins even over the property, which looks
 * backwards until you consider a completed job. `bookings.address` records
 * where work ACTUALLY happened; invoices were drawn from it and someone was
 * paid for going there. If a host later corrects a property's address — fixes
 * a typo, or the unit is renumbered — letting that rewrite history would
 * silently restate finished work and the invoices attached to it.
 *
 * So: the property is the source of truth for jobs not yet booked, and the
 * snapshot is the source of truth for jobs already booked. New bookings copy
 * the property's address into that snapshot at creation, which is what keeps
 * the two in agreement for everything current.
 */
export function jobAddress(args: {
  bookingAddress?: string | null;
  property?: PropertyLike | null;
  clientAddress?: string | null;
}): string | null {
  const first = [
    args.bookingAddress,
    args.property?.address,
    args.clientAddress,
  ].find((a) => typeof a === "string" && a.trim().length > 0);
  return first ? first.trim() : null;
}

/**
 * WHAT A HUMAN CALLS IT.
 *
 * Returns null rather than inventing a label. A booking with no property is
 * the overwhelmingly common case — every single-address client in the app —
 * and rendering "Main address" over all of them is noise that trains people
 * to stop reading the field.
 */
export function propertyLabel(property?: PropertyLike | null): string | null {
  const l = property?.label;
  return typeof l === "string" && l.trim().length > 0 ? l.trim() : null;
}

/**
 * WHICH CHECKLIST APPLIES.
 *
 * The property overrides the client. A studio turnover and a four-bedroom
 * house belong to the same payer and are not remotely the same clean, so a
 * client-level default is the wrong altitude the moment a second property
 * exists. Falls back to the client's default so nothing changes for the
 * clients that have only ever had one.
 */
export function checklistTemplateFor(args: {
  property?: PropertyLike | null;
  clientDefaultTemplateId?: string | null;
}): string | null {
  return (
    args.property?.default_checklist_template_id ??
    args.clientDefaultTemplateId ??
    null
  );
}

/**
 * How a property reads in a picker or on an invoice line: "Unit 3 — 155 Whyte
 * Ave". Falls back to whichever half exists so a property with no address yet,
 * or an address with no meaningful name, still renders as something.
 */
export function propertyDisplay(property?: PropertyLike | null): string {
  const label = propertyLabel(property);
  const addr = property?.address?.trim();
  if (label && addr) return `${label} — ${addr}`;
  return label ?? addr ?? "Untitled property";
}

/**
 * Whether this client needs the property UI at all.
 *
 * Everything about properties is hidden for a client with one, so the 71 of
 * Svit's 72 clients who own a single house never see a concept they do not
 * need. The backfill gives every existing client exactly one property, so
 * this is false everywhere until somebody deliberately adds a second.
 */
export function isMultiProperty(
  properties: ReadonlyArray<PropertyLike> | null | undefined,
): boolean {
  return (properties?.length ?? 0) > 1;
}
