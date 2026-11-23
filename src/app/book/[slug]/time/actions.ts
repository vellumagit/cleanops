"use server";

import { headers } from "next/headers";
import { enterFailClosed } from "@/lib/supabase/query-guard";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { checkEmailRateLimit, checkIpRateLimit, getIp } from "@/lib/rate-limit-helpers";
import { TURNSTILE_FIELD, verifyTurnstile } from "@/lib/turnstile";
import { findOrCreateClient } from "@/lib/find-or-create-client";
import { normalizePhone } from "@/lib/phone";
import { sendOrgEmail } from "@/lib/email";
import { detectCardNumber, CARD_DETECTED_MESSAGE } from "@/lib/card-detection";
import { canBookTime, publicBookingPage } from "@/lib/booking-page";
import { bookTimeOnline, publicOpenTimes, type PublicDay } from "@/lib/online-booking";

/**
 * "Book a clean" on a company's page: a visitor with no sign-in picks a
 * service, a day and a time, and a real visit is saved (roadmap phase 3).
 *
 * Only when the company switched it on (Settings, Online booking), only on
 * a published page, and only for a service that is on the page and has a
 * length. The times come from the server and are checked again in the save
 * (lib/online-booking.ts).
 *
 * The same guards as "Ask for a clean": a hidden field only a script fills,
 * limits per connection and per email, the human check on the last step.
 * And the same silence: an email that is already a client's gets the same
 * answer as a new one, and none of that client's details come back.
 */
export type TimesState = { days: PublicDay[]; nextFrom: string | null; error?: string };

/** The page, when a visitor may book a time for this service on it. */
async function bookable(slug: string, serviceId: string) {
  const found = await publicBookingPage(slug);
  if (!found || found.page.time_booking === "off") return null;
  const service = found.services.find((s) => s.id === serviceId && canBookTime(s));
  return service ? { found, service } : null;
}

export async function openTimesAction(slug: string, serviceId: string, fromYmd: string | null): Promise<TimesState> {
  enterFailClosed();
  const none = (error: string): TimesState => ({ days: [], nextFrom: null, error });
  const limit = await checkIpRateLimit("book-times", 60, 60_000);
  if (!limit.allowed) return none("That's a lot of looking. Wait a minute and try again.");
  const page = await bookable(String(slug ?? ""), String(serviceId ?? ""));
  if (!page) return none("This can't be booked online right now.");
  const from = fromYmd && /^\d{4}-\d{2}-\d{2}$/.test(fromYmd) ? fromYmd : undefined;
  const res = await publicOpenTimes({ organizationId: page.found.page.organization_id, serviceId: page.service.id, fromYmd: from });
  if (!res.ok) return none(res.error);
  return { days: res.days, nextFrom: res.nextFrom };
}

export type BookState = {
  /** Booked: what to tell them. */
  done?: { when: string; held: boolean };
  /** The time went while they were typing: pick another. */
  taken?: boolean;
  error?: string;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export async function bookTimeAction(_prev: BookState, formData: FormData): Promise<BookState> {
  enterFailClosed();

  // A field no person sees. Filled in means a script: nothing is booked.
  if (String(formData.get("website") ?? "").trim()) return { error: "We couldn't take that booking. Please call us." };

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const phoneRaw = String(formData.get("phone") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const note = String(formData.get("notes") ?? "").trim();
  if (!name) return { error: "Tell us your name." };
  if (name.length > 200) return { error: "That name is too long." };
  if (!email || !EMAIL.test(email) || email.length > 254) {
    return { error: "We need an email address to send your confirmation to. Check it and try again." };
  }
  if (phoneRaw.length > 40) return { error: "That phone number is too long." };
  if (!address) return { error: "Tell us the address of the place to clean." };
  if (address.length > 300) return { error: "Keep the address under 300 characters." };
  if (note.length > 1000) return { error: "Keep the note under 1000 characters." };
  // A card number typed into a free-text box must not land in the database.
  if (detectCardNumber(address) || detectCardNumber(note)) return { error: CARD_DETECTED_MESSAGE };

  const byIp = await checkIpRateLimit("book-time", 6, 60 * 60_000);
  const byEmail = await checkEmailRateLimit("book-time", email, 3, 60 * 60_000);
  if (!byIp.allowed || !byEmail.allowed) {
    return { error: "You've made a few bookings already. To book another, or change one, call us." };
  }

  const page = await bookable(String(formData.get("slug") ?? ""), String(formData.get("service_id") ?? ""));
  if (!page) return { error: "This can't be booked online any more. Go back to the page and ask for a clean instead." };
  const { found, service } = page;
  // A draft opens for the company's own office, to look at. Nothing real
  // comes out of a page nobody has published.
  if (found.preview) return { error: "This is a preview, so nothing is booked. Publish your page and it will take bookings." };
  const mode = found.page.time_booking;
  if (mode === "off") return { error: "This can't be booked online any more." };

  const ip = getIp(await headers());
  if (!(await verifyTurnstile(String(formData.get(TURNSTILE_FIELD) ?? "") || null, ip))) {
    return { error: "We couldn't confirm you're a person. Tick the check above the button and try again." };
  }

  const orgId = found.page.organization_id;
  const admin = createSupabaseAdminClient();
  // Found by email, or added as a lead. Quietly: nothing about an existing
  // record comes back to the page.
  const clientId = await findOrCreateClient(
    admin,
    orgId,
    { name, email, ...(phoneRaw ? { phone: normalizePhone(phoneRaw) } : {}), address },
    { createAs: "lead", leadSource: "web_form" },
  );
  if (!clientId) return { error: "We couldn't take a booking with that email address. Try another, or call us." };

  const res = await bookTimeOnline({
    organizationId: orgId,
    mode,
    serviceId: service.id,
    startMs: Number(formData.get("at")),
    client: { id: clientId, name },
    address,
    note,
  });
  if (!res.ok) return res.taken ? { taken: true } : { error: res.error };

  if (res.status === "pending") {
    // Held, not confirmed: say so, so nobody takes a day off work for it
    // yet. The real confirmation goes out when the office confirms. They
    // asked for this, so the platform's "pause client emails" doesn't apply.
    const first = name.split(/\s+/)[0];
    const company = found.company.name;
    sendOrgEmail(orgId, {
      to: email,
      toName: name,
      pauseExempt: true,
      subject: `${company} is holding your time`,
      html: `<p style="font-size:16px;">Hi ${escapeHtml(first)},</p>
<p style="font-size:16px;">${escapeHtml(company)} is holding <strong>${escapeHtml(res.when)}</strong> for your ${escapeHtml(service.name)}.</p>
<p style="font-size:16px;">It isn't confirmed yet. You'll get another message as soon as ${escapeHtml(company)} confirms it.</p>
<p style="color:#666;font-size:13px;">If you didn't ask for this, you can ignore this message.</p>`,
      text: `Hi ${first},\n\n${company} is holding ${res.when} for your ${service.name}.\n\nIt isn't confirmed yet. You'll get another message as soon as ${company} confirms it.\n\nIf you didn't ask for this, you can ignore this message.`,
    }).catch((err) => console.error("[book] held-time email failed:", err));
  }

  return { done: { when: res.when, held: res.status === "pending" } };
}
