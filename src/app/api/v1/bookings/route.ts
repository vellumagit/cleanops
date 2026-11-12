import { NextRequest, NextResponse, after } from "next/server";
import { authenticateApiKey } from "@/lib/api-key-auth";
import { apiServerError } from "@/lib/api/errors";
import { allowDbErrors } from "@/lib/supabase/query-guard";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dispatchWebhookEvent } from "@/lib/webhooks";
import { findOrCreateClient } from "@/lib/find-or-create-client";
import { findCrossOrgRef } from "@/lib/api/org-scope";
import { syncJob } from "@/lib/job-sync";
import { resyncBookingCalendars } from "@/lib/booking-calendar-sync";
import {
  futureStatusError,
  WRITABLE_BOOKING_STATUSES,
  WRITABLE_BOOKING_STATUS_LIST,
} from "@/lib/booking-status";
import {
  isValidServiceTypeEnum,
  resolveServiceTypeColumns,
} from "@/lib/api/service-type-columns";

/**
 * GET /api/v1/bookings — List bookings for the authenticated org.
 *
 * Query params:
 *   ?limit=25          (default 25, max 100)
 *   ?offset=0
 *   ?status=pending     (filter by status)
 *   ?client_id=uuid     (filter by client)
 *   ?since=ISO          (updated_at >= value)
 *   ?scheduled_after=ISO
 *   ?scheduled_before=ISO
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if (!auth.ok) return auth.response;

  const url = request.nextUrl;
  const limit = Math.min(Number(url.searchParams.get("limit")) || 25, 100);
  const offset = Number(url.searchParams.get("offset")) || 0;
  const status = url.searchParams.get("status") ?? "";
  const clientId = url.searchParams.get("client_id") ?? "";
  const since = url.searchParams.get("since") ?? "";
  const scheduledAfter = url.searchParams.get("scheduled_after") ?? "";
  const scheduledBefore = url.searchParams.get("scheduled_before") ?? "";

  const admin = createSupabaseAdminClient();
  let query = admin
    .from("bookings")
    .select(
      `id, client_id, assigned_to, scheduled_at, duration_minutes,
       service_type, service_type_id, service_type_label,
       status, total_cents, hourly_rate_cents, address, notes,
       created_at, updated_at,
       client:clients ( name, email )`,
      { count: "exact" },
    )
    .eq("organization_id", auth.organizationId)
    .order("scheduled_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq("status", status as never);
  if (clientId) query = query.eq("client_id", clientId);
  if (since) query = query.gte("updated_at", since);
  if (scheduledAfter) query = query.gte("scheduled_at", scheduledAfter);
  if (scheduledBefore) query = query.lte("scheduled_at", scheduledBefore);

  const { data, count, error } = await query;
  if (error)
    return apiServerError("bookings", error);

  return NextResponse.json({
    data,
    pagination: { total: count ?? 0, limit, offset },
  });
}

/**
 * POST /api/v1/bookings — Create a booking.
 *
 * Accepts EITHER:
 *   - `client_id` (UUID) — use an existing client directly
 *   - `client_name` + optional `client_email` / `client_phone` / `client_address`
 *     → looks up by email first, then name, creates if not found
 *
 * Body: { client_id?, client_name?, client_email?, client_phone?,
 *         client_address?, scheduled_at, duration_minutes, service_type?,
 *         status?, total_cents?, hourly_rate_cents?, address?, notes?,
 *         assigned_to?, package_id? }
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  // ── Resolve client_id ─────────────────────────────────────
  let clientId = body.client_id as string | undefined;
  const clientName = body.client_name as string | undefined;
  const clientEmail = body.client_email as string | undefined;

  if (!clientId) {
    if (!clientName || typeof clientName !== "string" || !clientName.trim()) {
      return NextResponse.json(
        { error: "Provide either client_id (UUID) or client_name" },
        { status: 400 },
      );
    }
    clientId =
      (await findOrCreateClient(admin, auth.organizationId, {
        name: clientName.trim(),
        email: clientEmail?.trim(),
        phone: (body.client_phone as string)?.trim(),
        address: (body.client_address as string)?.trim(),
      })) ?? undefined;
    if (!clientId) {
      return NextResponse.json(
        { error: "Failed to resolve client" },
        { status: 500 },
      );
    }
  }

  // Directly-supplied foreign ids must belong to this org — the insert uses
  // the service-role client (RLS bypassed) and read routes embed
  // client:clients(name,email). (A client_id resolved via findOrCreateClient
  // above is already org-scoped; absent fields are skipped.)
  const badRef = await findCrossOrgRef(admin, auth.organizationId, {
    client_id: body.client_id,
    assigned_to: body.assigned_to,
    package_id: body.package_id,
  });
  if (badRef) {
    return NextResponse.json(
      { error: `Invalid ${badRef}: not found in your organization` },
      { status: 400 },
    );
  }

  const scheduled_at = body.scheduled_at as string | undefined;
  const duration_minutes = body.duration_minutes as number | undefined;

  if (!scheduled_at)
    return NextResponse.json(
      { error: "scheduled_at is required" },
      { status: 400 },
    );
  if (!duration_minutes)
    return NextResponse.json(
      { error: "duration_minutes is required" },
      { status: 400 },
    );

  // Same treatment service_type gets twelve lines down: validate against the
  // live enum rather than letting Postgres reject it, and refuse a status the
  // date cannot support. This route writes through the service-role client, so
  // an API key was all it took to create the a766d848 shape — a future job
  // already marked completed, which silently swallows the crew's accept prompt.
  const requestedStatus = (body.status as string | undefined) ?? "confirmed";
  if (
    !WRITABLE_BOOKING_STATUSES.includes(
      requestedStatus as (typeof WRITABLE_BOOKING_STATUSES)[number],
    )
  ) {
    return NextResponse.json(
      {
        error: `Invalid status. Allowed: ${WRITABLE_BOOKING_STATUS_LIST}.`,
      },
      { status: 400 },
    );
  }
  const statusErr = futureStatusError(scheduled_at, requestedStatus);
  if (statusErr) {
    return NextResponse.json({ error: statusErr }, { status: 400 });
  }

  // Validate service_type against the enum and resolve FK + label
  // from the org's catalog. Defaults to "standard" when omitted. An
  // invalid value gets a 400 instead of a Postgres enum error.
  const requestedServiceType =
    (body.service_type as string | undefined) ?? "standard";
  if (!isValidServiceTypeEnum(requestedServiceType)) {
    return NextResponse.json(
      {
        error:
          "Invalid service_type. Allowed: standard, deep, move_out, recurring, meeting, consultation, walkthrough, other.",
      },
      { status: 400 },
    );
  }
  const serviceCols = await resolveServiceTypeColumns(
    admin,
    auth.organizationId,
    requestedServiceType,
  );
  // resolveServiceTypeColumns only returns null when the enum itself
  // is invalid, which we already 400'd above; assert non-null here.
  if (!serviceCols) {
    return NextResponse.json(
      { error: "Failed to resolve service_type" },
      { status: 500 },
    );
  }

  // 23P01 is the database refusing a cleaner who is already booked then
  // (assigned_to puts them on the crew as the row goes in). Answered in words;
  // in the fail-closed scope it would otherwise be a bare 500.
  const { data, error } = (await allowDbErrors(["23P01"], admin
    .from("bookings" as never)
    .insert({
      organization_id: auth.organizationId,
      client_id: clientId,
      scheduled_at,
      duration_minutes,
      service_type: serviceCols.service_type,
      service_type_id: serviceCols.service_type_id,
      service_type_label: serviceCols.service_type_label,
      status: requestedStatus,
      // Created as already done is a person saying it's over; closed_at is
      // how the rules hear it (same as the booking form). Without it the
      // first recompute reads "no shifts" and puts the row back.
      closed_at: requestedStatus === "completed" ? new Date().toISOString() : null,
      total_cents: (body.total_cents as number) ?? 0,
      hourly_rate_cents: (body.hourly_rate_cents as number) ?? null,
      address: (body.address as string) ?? null,
      notes: (body.notes as string) ?? null,
      assigned_to: (body.assigned_to as string) ?? null,
      package_id: (body.package_id as string) ?? null,
    } as never)
    .select(
      "id, client_id, scheduled_at, duration_minutes, service_type, service_type_id, service_type_label, status, total_cents, address, notes, created_at",
    )
    .single())) as unknown as { data: Record<string, unknown>; error: { code?: string; message: string } | null };

  if (error?.code === "23P01") {
    return NextResponse.json(
      { error: "That cleaner already has a booking at that time. Nothing was created." },
      { status: 409 },
    );
  }
  if (error)
    return apiServerError("bookings", error);

  const created = data as unknown as { id: string };
  // The roster lives in booking_assignees; assigned_to is only the
  // denormalised primary pointer. Until this row existed the rules saw an
  // empty crew on every API-created job: nobody to wait on, no window to
  // divide, and the cleaner's phone showed no shift to accept.
  const assignedTo = (body.assigned_to as string | undefined) ?? null;
  if (assignedTo) {
    // The route runs fail-closed (authenticateApiKey), so a failed insert
    // throws rather than returning its error; caught here so the booking it
    // belonged to is removed instead of left without its crew row.
    const messageOf = (e: unknown) =>
      e instanceof Error ? e.message : String((e as { message?: unknown } | null)?.message ?? e);
    let crewFailure: string | null = null;
    try {
      const { error: crewErr } = await admin
        .from("booking_assignees")
        .insert({
          organization_id: auth.organizationId,
          booking_id: created.id,
          membership_id: assignedTo,
          is_primary: true,
        } as never);
      if (crewErr) crewFailure = crewErr.message;
    } catch (err) {
      crewFailure = messageOf(err);
    }
    if (crewFailure) {
      let cleanupFailure: string | null = null;
      try {
        const { error: cleanupErr } = await admin
          .from("bookings")
          .delete()
          .eq("id", created.id)
          .eq("organization_id", auth.organizationId);
        if (cleanupErr) cleanupFailure = cleanupErr.message;
      } catch (err) {
        cleanupFailure = messageOf(err);
      }
      // The caller learns what happened in words, never the database's own
      // message (table and constraint names); the detail goes to the log.
      if (cleanupFailure) {
        console.error("[api/bookings] crew insert and booking cleanup failed:", crewFailure, cleanupFailure);
        return NextResponse.json(
          {
            error:
              "The booking was created but the cleaner could not be assigned, and removing the booking also failed. Delete it or assign someone in Sollos.",
            booking_id: created.id,
          },
          { status: 500 },
        );
      }
      const overlap = crewFailure.includes("23P01") || crewFailure.includes("overlapping booking");
      if (overlap) {
        return NextResponse.json(
          { error: "That cleaner already has a booking at that time. Nothing was created." },
          { status: 409 },
        );
      }
      return apiServerError("bookings: assign crew", crewFailure);
    }
  }
  await syncJob(created.id, "api_create");
  // The company's calendar and each cleaner's get the visit now, not at the
  // nightly reconcile — the API is how integrations book.
  after(() => resyncBookingCalendars(created.id));

  dispatchWebhookEvent(auth.organizationId, "booking.created", data).catch(
    () => {},
  );

  return NextResponse.json({ data }, { status: 201 });
}
