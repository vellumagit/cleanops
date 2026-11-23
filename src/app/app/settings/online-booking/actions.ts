"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { logAuditEvent } from "@/lib/audit";
import { allowDbErrors } from "@/lib/supabase/query-guard";
import { isPriceMode, nameProblem, tidyName } from "@/lib/booking-page-rules";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseRulesForm } from "@/lib/open-time-rules";

/**
 * Settings, Online booking: a company makes its own booking page here, and
 * nowhere else. Nothing is created for anyone automatically
 * (docs/online-booking-roadmap.md, "Nothing is created automatically").
 *
 *   create   claims the name and makes a DRAFT. Nothing is public.
 *   save     the words, the name, and which services show.
 *   publish  makes the link live; unpublish takes it down and keeps it all.
 *
 * Owners and admins only, like the rest of Settings. Written through the
 * caller's own session, so the database's policies decide too.
 */
export type OnlineBookingState = { ok?: string; error?: string };

const MAX_HEADLINE = 120;
const MAX_INTRO = 1500;

type Ctx = Awaited<ReturnType<typeof getActionContext>>;

async function admins(): Promise<{ ctx: Ctx } | { error: string }> {
  const ctx = await getActionContext();
  if (!["owner", "admin"].includes(ctx.membership.role)) {
    return { error: "Only owners and admins can set up the booking page." };
  }
  return { ctx };
}

function refresh(slug?: string | null) {
  revalidatePath("/app/settings/online-booking");
  if (slug) revalidatePath(`/book/${slug}`);
}

export async function createBookingPageAction(_prev: OnlineBookingState, formData: FormData): Promise<OnlineBookingState> {
  const who = await admins();
  if ("error" in who) return { error: who.error };
  const { membership, supabase } = who.ctx;

  const name = tidyName(String(formData.get("name") ?? ""));
  const problem = nameProblem(name);
  if (problem) return { error: problem };

  // 23505: the name is someone else's, or this company already has a page.
  // Expected, and answered in words below.
  const { error } = (await allowDbErrors(
    ["23505"],
    supabase.from("booking_pages" as never).insert({
      organization_id: membership.organization_id,
      slug: name,
      status: "draft",
      created_by: membership.id,
    } as never),
  )) as unknown as { error: { code?: string | null; message: string } | null };
  const nameTaken = error?.code === "23505";
  if (error) {
    // The same company pressing twice, or a name someone else holds.
    const { data: mine } = (await supabase
      .from("booking_pages" as never)
      .select("slug")
      .eq("organization_id" as never, membership.organization_id as never)
      .maybeSingle()) as unknown as { data: { slug: string } | null };
    if (mine) return { ok: "Your page already exists. It is below." };
    if (nameTaken) return { error: `"${name}" is already someone's link. Try another name.` };
    return { error: error.message };
  }

  await logAuditEvent({
    membership,
    action: "create",
    entity: "settings",
    entity_id: membership.organization_id,
    after: { booking_page: name, status: "draft" },
  });
  refresh(name);
  return { ok: "Your page is made, as a draft. Nobody else can see it until you publish it." };
}

export async function saveBookingPageAction(_prev: OnlineBookingState, formData: FormData): Promise<OnlineBookingState> {
  const who = await admins();
  if ("error" in who) return { error: who.error };
  const { membership, supabase } = who.ctx;
  const orgId = membership.organization_id;

  const { data: page } = (await supabase
    .from("booking_pages" as never)
    .select("slug")
    .eq("organization_id" as never, orgId as never)
    .maybeSingle()) as unknown as { data: { slug: string } | null };
  if (!page) return { error: "Make your page first." };

  const name = tidyName(String(formData.get("name") ?? page.slug));
  const problem = nameProblem(name);
  if (problem) return { error: problem };
  const headline = String(formData.get("headline") ?? "").trim();
  const intro = String(formData.get("intro") ?? "").trim();
  if (headline.length > MAX_HEADLINE) return { error: `Keep the headline under ${MAX_HEADLINE} characters.` };
  if (intro.length > MAX_INTRO) return { error: `Keep the introduction under ${MAX_INTRO} characters.` };

  // 23505: renamed to a name someone else holds. Expected.
  const { data: saved, error } = (await allowDbErrors(
    ["23505"],
    supabase
      .from("booking_pages" as never)
      .update({ slug: name, headline: headline || null, intro: intro || null } as never)
      .eq("organization_id" as never, orgId as never)
      .select("slug"),
  )) as unknown as { data: Array<{ slug: string }> | null; error: { code?: string | null; message: string } | null };
  const renameTaken = error?.code === "23505";
  if (error) {
    if (renameTaken) return { error: `"${name}" is already someone's link. Your other changes were not saved; try another name.` };
    return { error: error.message };
  }
  if (!saved?.length) return { error: "Your changes weren't saved. Reload the page and try again." };

  // Which services show, and how each one's price shows. Only this
  // company's own services are touched, whatever ids the form posted.
  const { data: services } = (await supabase
    .from("service_types")
    .select("id")
    .eq("organization_id", orgId)) as unknown as { data: Array<{ id: string }> | null };
  const shown = new Set(formData.getAll("show").map(String));
  for (const s of services ?? []) {
    // A service the form didn't list (archived, or added in another tab)
    // is left exactly as it is.
    if (!formData.has(`listed_${s.id}`)) continue;
    const mode = String(formData.get(`price_${s.id}`) ?? "hidden");
    const crew = Number(formData.get(`crew_${s.id}`) ?? 1);
    const { error: svcErr } = (await supabase
      .from("service_types")
      .update({
        show_on_booking_page: shown.has(s.id),
        booking_page_price: isPriceMode(mode) ? mode : "hidden",
        online_crew_size: Number.isInteger(crew) && crew >= 1 && crew <= 6 ? crew : 1,
      } as never)
      .eq("id", s.id)
      .eq("organization_id", orgId)) as unknown as { error: { message: string } | null };
    if (svcErr) return { error: `The page was saved, but a service's setting was not: ${svcErr.message}` };
  }

  refresh(page.slug);
  refresh(name);
  return {
    ok:
      name !== page.slug
        ? `Saved. Your link is now sollos3.com/book/${name}. The old link no longer works, so update it anywhere you shared it.`
        : "Saved.",
  };
}

export async function setBookingPagePublishedAction(_prev: OnlineBookingState, formData: FormData): Promise<OnlineBookingState> {
  const who = await admins();
  if ("error" in who) return { error: who.error };
  const { membership, supabase } = who.ctx;
  const publish = String(formData.get("publish") ?? "") === "1";

  const { data: saved, error } = (await supabase
    .from("booking_pages" as never)
    .update({ status: publish ? "published" : "draft", ...(publish ? { published_at: new Date().toISOString() } : {}) } as never)
    .eq("organization_id" as never, membership.organization_id as never)
    .select("slug")) as unknown as { data: Array<{ slug: string }> | null; error: { message: string } | null };
  if (error) return { error: error.message };
  if (!saved?.length) return { error: "Make your page first." };

  await logAuditEvent({
    membership,
    action: "update",
    entity: "settings",
    entity_id: membership.organization_id,
    after: { booking_page: saved[0].slug, status: publish ? "published" : "draft" },
  });
  refresh(saved[0].slug);
  return {
    ok: publish
      ? "Your page is live. Anyone with the link can open it."
      : "Your page is taken down. Everything you set up is kept, and requests already sent are still in your inbox.",
  };
}

/**
 * When the company can be booked online, and by whom (roadmap phase 2).
 *
 * The rules go on the booking page; "takes online bookings" goes on each
 * person. Only people the company ticks are ever offered to a visitor, and
 * nobody is ticked to start with.
 */
export async function saveOpenTimeRulesAction(_prev: OnlineBookingState, formData: FormData): Promise<OnlineBookingState> {
  const who = await admins();
  if ("error" in who) return { error: who.error };
  const { membership, supabase } = who.ctx;
  const orgId = membership.organization_id;

  const parsed = parseRulesForm((name) => String(formData.get(name) ?? ""));
  if (!parsed.ok) return { error: parsed.error };
  // Whether a visitor can pick a time at all. A form that doesn't say
  // (an older tab) leaves it as it is.
  const mode = String(formData.get("time_booking") ?? "");
  const timeBooking = ["off", "approve", "instant"].includes(mode) ? mode : null;

  const { data: saved, error } = (await supabase
    .from("booking_pages" as never)
    .update({
      opening_hours: parsed.rules.openingHours,
      min_notice_hours: parsed.rules.minNoticeHours,
      max_days_ahead: parsed.rules.maxDaysAhead,
      gap_minutes: parsed.rules.gapMinutes,
      slot_step_minutes: parsed.rules.stepMinutes,
      ...(timeBooking ? { time_booking: timeBooking } : {}),
    } as never)
    .eq("organization_id" as never, orgId as never)
    .select("slug")) as unknown as { data: Array<{ slug: string }> | null; error: { message: string } | null };
  if (error) return { error: error.message };
  if (!saved?.length) return { error: "Make your page first." };

  // Who takes online bookings. Pinned to this company's own active people,
  // whatever ids the form posted, and written past the membership rules
  // (which exist to stop role changes, not this).
  const admin = createSupabaseAdminClient();
  const { data: people } = (await admin
    .from("memberships")
    .select("id")
    .eq("organization_id", orgId)
    .eq("status", "active")) as unknown as { data: Array<{ id: string }> | null };
  const ticked = new Set(formData.getAll("takes").map(String));
  for (const person of people ?? []) {
    // Someone the form didn't list (added in another tab) is left alone.
    if (!formData.has(`cleaner_listed_${person.id}`)) continue;
    const { error: personErr } = (await admin
      .from("memberships")
      .update({ takes_online_bookings: ticked.has(person.id) } as never)
      .eq("id", person.id)
      .eq("organization_id", orgId)) as unknown as { error: { message: string } | null };
    if (personErr) return { error: `The hours were saved, but a person's setting was not: ${personErr.message}` };
  }

  if (timeBooking) {
    await logAuditEvent({
      membership,
      action: "update",
      entity: "settings",
      entity_id: orgId,
      after: { booking_page: saved[0].slug, time_booking: timeBooking },
    });
  }
  refresh(saved[0].slug);
  revalidatePath(`/book/${saved[0].slug}/time`);
  return { ok: "Saved. The preview below uses these." };
}
