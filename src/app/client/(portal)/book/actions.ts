"use server";

import { requireClientAction } from "@/lib/client-auth";
import { checkEmailRateLimit } from "@/lib/rate-limit-helpers";
import { detectCardNumber, CARD_DETECTED_MESSAGE } from "@/lib/card-detection";
import { clientBookingOffer } from "@/lib/booking-page";
import { getOrgName } from "@/lib/org-name";
import { bookTimeOnline, publicOpenTimes, sendHeldTimeEmail } from "@/lib/online-booking";
import type { BookState, TimesState } from "@/app/book/[slug]/time/actions";

/**
 * Booking a time from the signed-in client area (roadmap phase 6,
 * "signed-in clients rebook", 2026-11-25).
 *
 * The same open times and the same save as the public page
 * (lib/online-booking.ts), with what the company already knows filled in:
 * the visit goes on this client's own record, not a new lead, and no name,
 * email or human check is asked for. The company is the one the signed-in
 * client belongs to. Nothing from the browser names it.
 *
 * Only where the company lets its public page take bookings: the same
 * switch, the same services, the same confirm-each-one or straight-away.
 */

/** The service, when this client may book it now. */
async function offerFor(organizationId: string, serviceId: string) {
  const offer = await clientBookingOffer(organizationId);
  const service = offer?.services.find((s) => s.id === serviceId);
  return offer && service ? { offer, service } : null;
}

export async function clientOpenTimesAction(serviceId: string, fromYmd: string | null): Promise<TimesState> {
  const client = await requireClientAction();
  const none = (error: string): TimesState => ({ days: [], nextFrom: null, error });
  const limit = await checkEmailRateLimit("client-book-times", client.id, 60, 60_000);
  if (!limit.allowed) return none("That's a lot of looking. Wait a minute and try again.");
  const found = await offerFor(client.organization_id, String(serviceId ?? ""));
  if (!found) return none("This can't be booked online right now.");
  const from = fromYmd && /^\d{4}-\d{2}-\d{2}$/.test(fromYmd) ? fromYmd : undefined;
  const res = await publicOpenTimes({ organizationId: client.organization_id, serviceId: found.service.id, fromYmd: from });
  if (!res.ok) return none(res.error);
  return { days: res.days, nextFrom: res.nextFrom };
}

export async function clientBookTimeAction(_prev: BookState, formData: FormData): Promise<BookState> {
  const client = await requireClientAction();

  const address = String(formData.get("address") ?? "").trim();
  const note = String(formData.get("notes") ?? "").trim();
  if (!address) return { error: "Tell us the address of the place to clean." };
  if (address.length > 300) return { error: "Keep the address under 300 characters." };
  if (note.length > 1000) return { error: "Keep the note under 1000 characters." };
  // A card number typed into a free-text box must not land in the database.
  if (detectCardNumber(address) || detectCardNumber(note)) return { error: CARD_DETECTED_MESSAGE };

  // More room than a stranger gets (6 an hour), but still a ceiling.
  const limit = await checkEmailRateLimit("client-book-time", client.id, 6, 60 * 60_000);
  if (!limit.allowed) return { error: "You've made a few bookings already. To book another, or change one, call us." };

  const found = await offerFor(client.organization_id, String(formData.get("service_id") ?? ""));
  if (!found) return { error: "This can't be booked online any more. Ask for a clean instead." };
  const mode = found.offer.page.time_booking;
  if (mode === "off") return { error: "This can't be booked online any more." };

  const res = await bookTimeOnline({
    organizationId: client.organization_id,
    mode,
    serviceId: found.service.id,
    startMs: Number(formData.get("at")),
    client: { id: client.id, name: client.name },
    address,
    note,
    via: "client_area",
  });
  if (!res.ok) return res.taken ? { taken: true } : { error: res.error };

  if (res.status === "pending" && client.email) {
    sendHeldTimeEmail({
      organizationId: client.organization_id,
      to: client.email,
      name: client.name,
      company: await getOrgName(client.organization_id),
      when: res.when,
      service: found.service.name,
    });
  }

  return { done: { when: res.when, held: res.status === "pending" } };
}
