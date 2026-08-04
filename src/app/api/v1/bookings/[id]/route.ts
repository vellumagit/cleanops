import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api-key-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dispatchWebhookEvent } from "@/lib/webhooks";
import { findCrossOrgRef } from "@/lib/api/org-scope";
import {
  isValidServiceTypeEnum,
  resolveServiceTypeColumns,
} from "@/lib/api/service-type-columns";
import { futureStatusError } from "@/lib/booking-status";

/** The four live booking statuses. */
const BOOKING_STATUSES = ["confirmed", "in_progress", "completed", "cancelled"];

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/bookings/:id
 */
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await authenticateApiKey(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("bookings")
    .select(
      `id, client_id, assigned_to, scheduled_at, duration_minutes,
       service_type, service_type_id, service_type_label,
       status, total_cents, hourly_rate_cents, address, notes,
       created_at, updated_at,
       client:clients ( name, email )`,
    )
    .eq("id", id)
    .eq("organization_id", auth.organizationId)
    .maybeSingle();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data)
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  return NextResponse.json({ data });
}

/**
 * PATCH /api/v1/bookings/:id
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await authenticateApiKey(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const allowed = [
    "client_id",
    "assigned_to",
    "scheduled_at",
    "duration_minutes",
    "status",
    "total_cents",
    "hourly_rate_cents",
    "address",
    "notes",
    "package_id",
  ];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  // service_type handled separately so we can validate the enum +
  // resolve the FK columns. An API consumer changing the service of
  // an existing booking writes all three correlated columns
  // atomically — a more deliberate operation than the web form's
  // "lock the enum on edit" rule, since an API call is an explicit
  // change-of-service request, not the silent side-effect of saving
  // an unrelated field.
  const admin = createSupabaseAdminClient();

  // Foreign ids must belong to this org — the update uses the service-role
  // client (RLS bypassed) and read routes embed client:clients(name,email).
  const badRef = await findCrossOrgRef(admin, auth.organizationId, {
    client_id: updates.client_id,
    assigned_to: updates.assigned_to,
    package_id: updates.package_id,
  });
  if (badRef) {
    return NextResponse.json(
      { error: `Invalid ${badRef}: not found in your organization` },
      { status: 400 },
    );
  }

  if ("service_type" in body) {
    if (!isValidServiceTypeEnum(body.service_type)) {
      return NextResponse.json(
        {
          error:
            "Invalid service_type. Allowed: standard, deep, move_out, recurring, meeting, consultation, walkthrough, other.",
        },
        { status: 400 },
      );
    }
    const cols = await resolveServiceTypeColumns(
      admin,
      auth.organizationId,
      body.service_type as string,
    );
    if (cols) {
      updates.service_type = cols.service_type;
      updates.service_type_id = cols.service_type_id;
      updates.service_type_label = cols.service_type_label;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 },
    );
  }

  // Check previous status to decide which webhook event to fire. Also carries
  // scheduled_at, because this route is the only writer that can break the
  // status/date rule from BOTH directions — mark a future job completed, or
  // drag an already-completed job into next week. A body of
  // {scheduled_at: <future>} with no status field slips past any check that
  // only inspects body.status, so both sides are merged before judging.
  const { data: prev } = await admin
    .from("bookings")
    .select("status, scheduled_at")
    .eq("id", id)
    .eq("organization_id", auth.organizationId)
    .maybeSingle();

  if (prev) {
    const nextStatus = (updates.status as string | undefined) ?? prev.status;
    if (
      "status" in updates &&
      !BOOKING_STATUSES.includes(updates.status as string)
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid status. Allowed: confirmed, in_progress, completed, cancelled.",
        },
        { status: 400 },
      );
    }
    const statusErr = futureStatusError(
      (updates.scheduled_at as string | undefined) ?? prev.scheduled_at,
      nextStatus,
    );
    if (statusErr) {
      return NextResponse.json({ error: statusErr }, { status: 400 });
    }
  }

  const { data, error } = (await admin
    .from("bookings")
    .update(updates)
    .eq("id", id)
    .eq("organization_id", auth.organizationId)
    .select(
      "id, client_id, scheduled_at, duration_minutes, service_type, service_type_id, service_type_label, status, address, notes, updated_at",
    )
    .single()) as unknown as {
    data: Record<string, unknown> & { status?: string };
    error: { message: string } | null;
  };

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Update failed" },
      { status: 500 },
    );
  }

  // Fire appropriate webhook
  const newStatus = data.status as string;
  const oldStatus = prev?.status as string | undefined;
  if (newStatus === "cancelled" && oldStatus !== "cancelled") {
    dispatchWebhookEvent(auth.organizationId, "booking.cancelled", data).catch(
      () => {},
    );
  } else if (newStatus === "completed" && oldStatus !== "completed") {
    dispatchWebhookEvent(auth.organizationId, "booking.completed", data).catch(
      () => {},
    );
  } else {
    dispatchWebhookEvent(auth.organizationId, "booking.updated", data).catch(
      () => {},
    );
  }

  return NextResponse.json({ data });
}

/**
 * DELETE /api/v1/bookings/:id
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await authenticateApiKey(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("bookings")
    .delete()
    .eq("id", id)
    .eq("organization_id", auth.organizationId);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
