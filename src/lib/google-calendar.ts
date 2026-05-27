/**
 * Google Calendar integration service.
 *
 * Handles OAuth token refresh and CRUD operations against the Google
 * Calendar API v3. All tokens are stored encrypted in
 * `integration_connections` — we decrypt on each call, use them, and
 * re-encrypt if refreshed.
 *
 * The design is deliberately simple: one calendar per org (the primary
 * calendar of whichever Google account the admin connected). We create /
 * update / delete events as bookings change, and store the mapping in
 * `bookings.google_calendar_event_id`.
 */

import "server-only";
import { getEnv } from "@/lib/env";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GoogleTokens = {
  access_token: string;
  refresh_token: string | null;
  expires_at: Date | null;
};

type CalendarEvent = {
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime: string; timeZone?: string };
  end: { dateTime: string; timeZone?: string };
};

type ConnectionRow = {
  id: string;
  access_token_ciphertext: string | null;
  refresh_token_ciphertext: string | null;
  token_expires_at: string | null;
  metadata: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// OAuth helpers
// ---------------------------------------------------------------------------

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * Build the Google OAuth consent URL. Called from the "Connect" button
 * server action.
 */
export function buildGoogleOAuthUrl(state: string): string {
  const env = getEnv();
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CALENDAR_CLIENT_ID!,
    redirect_uri: `${env.NEXT_PUBLIC_SITE_URL}/api/integrations/google-calendar/callback`,
    response_type: "code",
    scope: [
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/userinfo.email",
    ].join(" "),
    access_type: "offline",
    // "select_account" forces Google to show the account picker every time
    // so users can't accidentally re-connect the wrong account silently.
    // "consent" ensures we always get a refresh token (required for long-lived
    // access — without it Google only issues one on the very first grant).
    prompt: "select_account consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Exchange an authorization code for access + refresh tokens.
 */
export async function exchangeCodeForTokens(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  email?: string;
}> {
  const env = getEnv();
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CALENDAR_CLIENT_ID!,
      client_secret: env.GOOGLE_CALENDAR_CLIENT_SECRET!,
      redirect_uri: `${env.NEXT_PUBLIC_SITE_URL}/api/integrations/google-calendar/callback`,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google token exchange failed: ${res.status} ${body}`);
  }

  const tokens = await res.json();

  // Fetch the user's email to show in the UI
  let email: string | undefined;
  try {
    const profileRes = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    );
    if (profileRes.ok) {
      const profile = await profileRes.json();
      email = profile.email;
    }
  } catch {
    // Non-critical — we just won't show the email
  }

  return { ...tokens, email };
}

/**
 * Refresh an expired access token using the stored refresh token.
 * Updates the `integration_connections` row with the new ciphertext.
 */
async function refreshAccessToken(
  connectionId: string,
  refreshTokenCiphertext: string,
): Promise<string> {
  const env = getEnv();
  const refreshToken = decryptSecret(refreshTokenCiphertext);
  if (!refreshToken) throw new Error("No refresh token available");

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CALENDAR_CLIENT_ID!,
      client_secret: env.GOOGLE_CALENDAR_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    // Mark the connection as error so the admin sees it needs re-auth
    const admin = createSupabaseAdminClient();
    await admin
      .from("integration_connections" as never)
      .update({
        status: "error",
        last_error: `Token refresh failed: ${res.status}`,
      } as never)
      .eq("id" as never, connectionId);
    throw new Error(`Google token refresh failed: ${res.status} ${body}`);
  }

  const data = await res.json();
  const newAccessToken: string = data.access_token;
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  // Persist the refreshed token
  const admin = createSupabaseAdminClient();
  await admin
    .from("integration_connections" as never)
    .update({
      access_token_ciphertext: encryptSecret(newAccessToken),
      token_expires_at: expiresAt,
      status: "active",
      last_error: null,
    } as never)
    .eq("id" as never, connectionId);

  return newAccessToken;
}

// ---------------------------------------------------------------------------
// Core: get a valid access token for an org or member
// ---------------------------------------------------------------------------

/**
 * Get an active org-level Google Calendar connection. Returns null if
 * there isn't one.
 *
 * IMPORTANT: filters membership_id IS NULL so it never accidentally
 * matches a member-level connection that shares the same org+provider.
 */
async function getConnection(
  organizationId: string,
): Promise<(ConnectionRow & { access_token: string }) | null> {
  const admin = createSupabaseAdminClient();
  const { data } = (await admin
    .from("integration_connections" as never)
    .select("id, access_token_ciphertext, refresh_token_ciphertext, token_expires_at, metadata")
    .eq("organization_id" as never, organizationId)
    .eq("provider" as never, "google_calendar")
    .eq("status" as never, "active")
    .is("membership_id" as never, null as never)
    .maybeSingle()) as unknown as { data: ConnectionRow | null };

  if (!data || !data.access_token_ciphertext) return null;

  // Check if token is expired (with 60s buffer)
  const isExpired =
    data.token_expires_at &&
    new Date(data.token_expires_at).getTime() < Date.now() + 60_000;

  let accessToken: string;
  if (isExpired && data.refresh_token_ciphertext) {
    accessToken = await refreshAccessToken(
      data.id,
      data.refresh_token_ciphertext,
    );
  } else {
    accessToken = decryptSecret(data.access_token_ciphertext)!;
  }

  return { ...data, access_token: accessToken };
}

// ---------------------------------------------------------------------------
// Google Calendar API calls
// ---------------------------------------------------------------------------

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

async function gcalFetch(
  accessToken: string,
  path: string,
  options?: RequestInit,
): Promise<Response> {
  return fetch(`${CALENDAR_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
}

/**
 * Create a Google Calendar event for a booking.
 * Returns the event ID or null if no connection exists.
 */
export async function createCalendarEvent(
  organizationId: string,
  booking: {
    id: string;
    scheduled_at: string;
    duration_minutes: number;
    service_type: string;
    address: string | null;
    notes: string | null;
    client_name?: string;
    employee_name?: string;
  },
): Promise<string | null> {
  const conn = await getConnection(organizationId);
  if (!conn) return null;

  const calendarId = (conn.metadata?.calendar_id as string) || "primary";
  const start = new Date(booking.scheduled_at);
  const end = new Date(start.getTime() + booking.duration_minutes * 60_000);

  const summary = [
    booking.service_type ? `${booking.service_type} clean` : "Cleaning",
    booking.client_name ? `— ${booking.client_name}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const descriptionParts = [];
  if (booking.employee_name)
    descriptionParts.push(`Assigned to: ${booking.employee_name}`);
  if (booking.notes) descriptionParts.push(`Notes: ${booking.notes}`);
  descriptionParts.push(`\nManaged by Sollos — /app/bookings/${booking.id}`);

  const event: CalendarEvent = {
    summary,
    description: descriptionParts.join("\n"),
    location: booking.address ?? undefined,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
  };

  const res = await gcalFetch(
    conn.access_token,
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    { method: "POST", body: JSON.stringify(event) },
  );

  if (!res.ok) {
    console.error(
      "[gcal] Failed to create event:",
      res.status,
      await res.text(),
    );
    return null;
  }

  const created = await res.json();
  const eventId: string = created.id;

  // Store the event ID on the booking — but only if it's still null.
  // A concurrent createCalendarEvent call (e.g. two overlapping bulkSync
  // runs) may have already written an ID.  The conditional prevents us from
  // overwriting it, which would leave a GCal orphan with no tracked ID.
  const admin = createSupabaseAdminClient();
  await admin
    .from("bookings")
    .update({ google_calendar_event_id: eventId } as never)
    .eq("id", booking.id)
    .is("google_calendar_event_id" as never, null as never);

  return eventId;
}

/**
 * Update an existing Google Calendar event when a booking changes.
 */
export async function updateCalendarEvent(
  organizationId: string,
  booking: {
    id: string;
    google_calendar_event_id: string;
    scheduled_at: string;
    duration_minutes: number;
    service_type: string;
    address: string | null;
    notes: string | null;
    client_name?: string;
    employee_name?: string;
  },
): Promise<boolean> {
  const conn = await getConnection(organizationId);
  if (!conn) return false;

  const calendarId = (conn.metadata?.calendar_id as string) || "primary";
  const start = new Date(booking.scheduled_at);
  const end = new Date(start.getTime() + booking.duration_minutes * 60_000);

  const summary = [
    booking.service_type ? `${booking.service_type} clean` : "Cleaning",
    booking.client_name ? `— ${booking.client_name}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const descriptionParts = [];
  if (booking.employee_name)
    descriptionParts.push(`Assigned to: ${booking.employee_name}`);
  if (booking.notes) descriptionParts.push(`Notes: ${booking.notes}`);
  descriptionParts.push(`\nManaged by Sollos — /app/bookings/${booking.id}`);

  const event: CalendarEvent = {
    summary,
    description: descriptionParts.join("\n"),
    location: booking.address ?? undefined,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
  };

  const res = await gcalFetch(
    conn.access_token,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(booking.google_calendar_event_id)}`,
    { method: "PATCH", body: JSON.stringify(event) },
  );

  if (!res.ok) {
    // 404/410 means the event was deleted or is on a different calendar
    // (e.g. after an account switch). Fall through to create a fresh event
    // so the booking self-heals rather than silently failing forever.
    if (res.status === 404 || res.status === 410) {
      const newEventId = await createCalendarEvent(organizationId, {
        id: booking.id,
        scheduled_at: booking.scheduled_at,
        duration_minutes: booking.duration_minutes,
        service_type: booking.service_type,
        address: booking.address,
        notes: booking.notes,
        client_name: booking.client_name,
        employee_name: booking.employee_name,
      });
      return newEventId !== null;
    }
    console.error(
      "[gcal] Failed to update event:",
      res.status,
      await res.text(),
    );
    return false;
  }

  return true;
}

/**
 * Delete a Google Calendar event when a booking is deleted or cancelled.
 */
export async function deleteCalendarEvent(
  organizationId: string,
  googleCalendarEventId: string,
): Promise<boolean> {
  const conn = await getConnection(organizationId);
  if (!conn) return false;

  const calendarId = (conn.metadata?.calendar_id as string) || "primary";

  const res = await gcalFetch(
    conn.access_token,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleCalendarEventId)}`,
    { method: "DELETE" },
  );

  // 410 Gone means already deleted — that's fine
  if (!res.ok && res.status !== 410) {
    console.error(
      "[gcal] Failed to delete event:",
      res.status,
      await res.text(),
    );
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Pull: list events from Google Calendar
// ---------------------------------------------------------------------------

export type GoogleCalendarListEvent = {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: string; // ISO datetime
  end: string; // ISO datetime
  htmlLink?: string;
};

/**
 * Fetch events from the connected Google Calendar in a given time range.
 * Returns an empty array if no connection exists or on any failure.
 */
export async function listCalendarEvents(
  organizationId: string,
  timeMin: string,
  timeMax: string,
): Promise<GoogleCalendarListEvent[]> {
  const conn = await getConnection(organizationId);
  if (!conn) return [];

  const calendarId = (conn.metadata?.calendar_id as string) || "primary";

  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true", // expand recurring events
    orderBy: "startTime",
    maxResults: "250",
  });

  const res = await gcalFetch(
    conn.access_token,
    `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
  );

  if (!res.ok) {
    console.error("[gcal] Failed to list events:", res.status, await res.text());
    return [];
  }

  const data = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data.items ?? []) as any[])
    .filter((item) => item.status !== "cancelled")
    // Filter out events pushed from Sollos to avoid duplicates
    .filter((item) => !(item.description ?? "").includes("Managed by Sollos"))
    .map((item) => ({
      id: item.id,
      summary: item.summary ?? "(No title)",
      description: item.description,
      location: item.location,
      start: item.start?.dateTime ?? item.start?.date ?? "",
      end: item.end?.dateTime ?? item.end?.date ?? "",
      htmlLink: item.htmlLink,
    }));
}

/**
 * Delete all upcoming Google Calendar events for an org from the currently
 * connected calendar, then null out google_calendar_event_id on those
 * bookings so the next create/update pushes fresh events to whatever
 * calendar is connected afterward.
 *
 * Called before disconnecting and before switching accounts so:
 *   - the old calendar is left clean (no orphaned Sollos events)
 *   - stale event IDs don't cause silent failures on future updates
 *
 * Fire-and-forget safe: every individual failure is swallowed so a partial
 * GCal outage never blocks the disconnect flow.
 */
export async function cleanupOrgCalendarEvents(
  organizationId: string,
): Promise<void> {
  const conn = await getConnection(organizationId);
  if (!conn) return;

  const calendarId = (conn.metadata?.calendar_id as string) || "primary";
  const admin = createSupabaseAdminClient();

  // Find all upcoming bookings that have a linked calendar event.
  // Bookings have organization_id directly, so no join needed.
  const now = new Date().toISOString();
  const { data: bookings } = (await admin
    .from("bookings")
    .select("id, google_calendar_event_id")
    .eq("organization_id" as never, organizationId as never)
    .gte("scheduled_at" as never, now as never)
    .not(
      "google_calendar_event_id" as never,
      "is" as never,
      null as never,
    )) as unknown as {
    data: Array<{ id: string; google_calendar_event_id: string }> | null;
  };

  if (!bookings || bookings.length === 0) return;

  // Delete from Google Calendar — track per-booking outcome so we only null
  // IDs for events we KNOW are gone. If a delete fails (e.g. expired token,
  // network blip) we keep the ID in the DB. This prevents a later
  // bulkSyncUpcomingBookings from creating a second event for the same
  // booking while the original still exists on the calendar (doubling bug).
  const results = await Promise.allSettled(
    bookings.map((b) =>
      gcalFetch(
        conn.access_token,
        `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(b.google_calendar_event_id)}`,
        { method: "DELETE" },
      ),
    ),
  );

  // An event is "confirmed gone" if the delete returned 2xx, 404 (not found
  // — already deleted), or 410 (gone). Any other status or a network error
  // means we can't be sure, so we leave the ID intact.
  const clearedIds = bookings
    .filter((_, i) => {
      const r = results[i];
      if (r.status === "rejected") return false;
      const { status } = r.value;
      return status === 204 || status === 200 || status === 404 || status === 410;
    })
    .map((b) => b.id);

  if (clearedIds.length === 0) return;

  // Reset IDs only for confirmed-gone events so future creates/updates go to
  // the correct calendar without risk of duplication.
  await admin
    .from("bookings")
    .update({ google_calendar_event_id: null } as never)
    .in(
      "id" as never,
      clearedIds as never,
    );
}

/**
 * Push all upcoming bookings for an org to the newly-connected calendar.
 *
 * Called immediately after a new connection is saved so the calendar
 * is fully populated without the user having to touch every booking.
 * Only syncs bookings that don't already have a google_calendar_event_id
 * (i.e. new connections and post-switch cleanups).
 *
 * Runs in parallel batches of 10 to stay well within Google's per-second
 * quota while not taking forever for orgs with many upcoming bookings.
 */
export async function bulkSyncUpcomingBookings(
  organizationId: string,
): Promise<void> {
  const conn = await getConnection(organizationId);
  if (!conn) return;

  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();

  // Fetch upcoming bookings that haven't been synced yet, joined to client
  // for the client name. Limit to 500 to guard against pathological cases.
  // splits is included so split-shift bookings get an event spanning the
  // sum of segment durations (matching createBookingAction's behavior)
  // rather than the booking's overall duration_minutes which is a slot
  // length and can be longer than the actual work.
  const { data: bookings } = (await admin
    .from("bookings")
    .select(
      `id, scheduled_at, duration_minutes, service_type, address, notes,
       assigned_to, splits,
       client:clients!inner ( name ),
       assignee:memberships ( display_name, profile:profiles ( full_name ) )`,
    )
    .eq("organization_id" as never, organizationId as never)
    .gte("scheduled_at" as never, now as never)
    .is("google_calendar_event_id" as never, null as never)
    .neq("status" as never, "cancelled" as never)
    .order("scheduled_at" as never, { ascending: true } as never)
    .limit(500)) as unknown as {
    data: Array<{
      id: string;
      scheduled_at: string;
      duration_minutes: number;
      service_type: string;
      address: string | null;
      notes: string | null;
      assigned_to: string | null;
      splits: Array<{ duration_minutes?: number }> | null;
      client: { name: string } | null;
      assignee: {
        display_name: string | null;
        profile: { full_name: string | null } | null;
      } | null;
    }> | null;
  };

  if (!bookings || bookings.length === 0) return;

  // Process in batches of 10 (parallel within batch, sequential between).
  const BATCH = 10;
  for (let i = 0; i < bookings.length; i += BATCH) {
    await Promise.allSettled(
      bookings.slice(i, i + BATCH).map((b) => {
        const employeeName =
          b.assignee?.display_name ??
          b.assignee?.profile?.full_name ??
          undefined;
        // For split bookings, use the sum of segment durations so the
        // org GCal event matches what createBookingAction originally
        // wrote. duration_minutes on the bookings row may be the slot
        // length, not the actual work span.
        const splitsArr = Array.isArray(b.splits) ? b.splits : [];
        const effectiveDuration =
          splitsArr.length > 0
            ? splitsArr.reduce(
                (sum, s) => sum + (Number(s.duration_minutes) || 0),
                0,
              )
            : b.duration_minutes;
        return createCalendarEvent(organizationId, {
          id: b.id,
          scheduled_at: b.scheduled_at,
          duration_minutes: effectiveDuration,
          service_type: b.service_type,
          address: b.address,
          notes: b.notes,
          client_name: b.client?.name,
          employee_name: employeeName,
        }).catch(() => {});
      }),
    );
  }
}

/**
 * Check if an org has an active org-level Google Calendar connection.
 * Lightweight check — no token decryption.
 */
export async function hasGoogleCalendarConnection(
  organizationId: string,
): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { count } = await admin
    .from("integration_connections" as never)
    .select("id", { count: "exact", head: true })
    .eq("organization_id" as never, organizationId)
    .eq("provider" as never, "google_calendar")
    .eq("status" as never, "active")
    .is("membership_id" as never, null as never);
  return (count ?? 0) > 0;
}

// ===========================================================================
// PER-MEMBER GOOGLE CALENDAR
// ===========================================================================
// Each member can optionally connect their own personal Google Calendar.
// Events for their assigned bookings are pushed to their personal calendar
// independently of the org-level connection.
// All tokens are encrypted with the same INTEGRATION_ENCRYPTION_KEY and
// stored in integration_connections with membership_id set.
// Event IDs are tracked in booking_member_calendar_events (not bookings).
// ===========================================================================

// ---------------------------------------------------------------------------
// Member connection helpers
// ---------------------------------------------------------------------------

type MemberConnectionRow = ConnectionRow; // same shape, different lookup

/**
 * Get an active member-level Google Calendar connection.
 * Handles token refresh just like getConnection does for org-level.
 */
async function getMemberConnection(
  membershipId: string,
): Promise<(MemberConnectionRow & { access_token: string }) | null> {
  const admin = createSupabaseAdminClient();
  const { data } = (await admin
    .from("integration_connections" as never)
    .select("id, access_token_ciphertext, refresh_token_ciphertext, token_expires_at, metadata")
    .eq("membership_id" as never, membershipId)
    .eq("provider" as never, "google_calendar")
    .eq("status" as never, "active")
    .maybeSingle()) as unknown as { data: MemberConnectionRow | null };

  if (!data || !data.access_token_ciphertext) return null;

  const isExpired =
    data.token_expires_at &&
    new Date(data.token_expires_at).getTime() < Date.now() + 60_000;

  let accessToken: string;
  if (isExpired && data.refresh_token_ciphertext) {
    accessToken = await refreshAccessToken(data.id, data.refresh_token_ciphertext);
  } else {
    accessToken = decryptSecret(data.access_token_ciphertext)!;
  }

  return { ...data, access_token: accessToken };
}

/**
 * Check if a member has an active personal Google Calendar connection.
 * Lightweight — no token decryption.
 */
export async function hasMemberCalendarConnection(
  membershipId: string,
): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { count } = await admin
    .from("integration_connections" as never)
    .select("id", { count: "exact", head: true })
    .eq("membership_id" as never, membershipId)
    .eq("provider" as never, "google_calendar")
    .eq("status" as never, "active");
  return (count ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Member-level CRUD
// ---------------------------------------------------------------------------

type BookingForMemberEvent = {
  id: string;
  scheduled_at: string;
  duration_minutes: number;
  service_type: string;
  address: string | null;
  notes: string | null;
  client_name?: string;
};

function buildMemberEventPayload(
  booking: BookingForMemberEvent,
): CalendarEvent {
  const start = new Date(booking.scheduled_at);
  const end = new Date(start.getTime() + booking.duration_minutes * 60_000);
  const summary = [
    booking.service_type ? `${booking.service_type} clean` : "Cleaning",
    booking.client_name ? `— ${booking.client_name}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const descParts: string[] = [];
  if (booking.notes) descParts.push(`Notes: ${booking.notes}`);
  descParts.push(`\nManaged by Sollos — /field/jobs/${booking.id}`);
  return {
    summary,
    description: descParts.join("\n"),
    location: booking.address ?? undefined,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
  };
}

/**
 * Create a Google Calendar event on a member's personal calendar for an
 * assigned booking. Upserts the mapping in booking_member_calendar_events.
 * Returns the event ID or null on failure / no connection.
 */
export async function createMemberCalendarEvent(
  membershipId: string,
  booking: BookingForMemberEvent,
): Promise<string | null> {
  const conn = await getMemberConnection(membershipId);
  if (!conn) return null;

  const calendarId = (conn.metadata?.calendar_id as string) || "primary";
  const event = buildMemberEventPayload(booking);

  const res = await gcalFetch(
    conn.access_token,
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    { method: "POST", body: JSON.stringify(event) },
  );

  if (!res.ok) {
    console.error("[gcal/member] Failed to create event:", res.status, await res.text());
    return null;
  }

  const created = await res.json();
  const eventId: string = created.id;

  // Upsert the mapping — concurrent calls are fine; ON CONFLICT DO UPDATE
  // just refreshes the ID.
  const admin = createSupabaseAdminClient();
  await admin
    .from("booking_member_calendar_events" as never)
    .upsert(
      {
        booking_id: booking.id,
        membership_id: membershipId,
        google_calendar_event_id: eventId,
      } as never,
      { onConflict: "booking_id,membership_id" } as never,
    );

  return eventId;
}

/**
 * Update an existing event on a member's personal calendar.
 * Falls back to create if the event is gone (404/410).
 */
export async function updateMemberCalendarEvent(
  membershipId: string,
  booking: BookingForMemberEvent,
): Promise<boolean> {
  const conn = await getMemberConnection(membershipId);
  if (!conn) return false;

  // Look up the existing event ID for this (booking, member) pair.
  const admin = createSupabaseAdminClient();
  const { data: mapping } = (await admin
    .from("booking_member_calendar_events" as never)
    .select("google_calendar_event_id")
    .eq("booking_id" as never, booking.id)
    .eq("membership_id" as never, membershipId)
    .maybeSingle()) as unknown as {
    data: { google_calendar_event_id: string } | null;
  };

  if (!mapping) {
    // No existing event — create one instead.
    const newId = await createMemberCalendarEvent(membershipId, booking);
    return newId !== null;
  }

  const calendarId = (conn.metadata?.calendar_id as string) || "primary";
  const event = buildMemberEventPayload(booking);

  const res = await gcalFetch(
    conn.access_token,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(mapping.google_calendar_event_id)}`,
    { method: "PATCH", body: JSON.stringify(event) },
  );

  if (!res.ok) {
    if (res.status === 404 || res.status === 410) {
      // Event missing on Google's side — create a fresh one.
      // Remove the stale row first so createMemberCalendarEvent upserts cleanly.
      await admin
        .from("booking_member_calendar_events" as never)
        .delete()
        .eq("booking_id" as never, booking.id)
        .eq("membership_id" as never, membershipId);
      const newId = await createMemberCalendarEvent(membershipId, booking);
      return newId !== null;
    }
    console.error("[gcal/member] Failed to update event:", res.status, await res.text());
    return false;
  }

  return true;
}

/**
 * Delete a member's personal calendar event for a booking and remove
 * the mapping row.
 */
export async function deleteMemberCalendarEvent(
  membershipId: string,
  bookingId: string,
): Promise<boolean> {
  const conn = await getMemberConnection(membershipId);
  const admin = createSupabaseAdminClient();

  if (conn) {
    const { data: mapping } = (await admin
      .from("booking_member_calendar_events" as never)
      .select("google_calendar_event_id")
      .eq("booking_id" as never, bookingId)
      .eq("membership_id" as never, membershipId)
      .maybeSingle()) as unknown as {
      data: { google_calendar_event_id: string } | null;
    };

    if (mapping) {
      const calendarId = (conn.metadata?.calendar_id as string) || "primary";
      const res = await gcalFetch(
        conn.access_token,
        `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(mapping.google_calendar_event_id)}`,
        { method: "DELETE" },
      );
      if (!res.ok && res.status !== 404 && res.status !== 410) {
        console.error("[gcal/member] Failed to delete event:", res.status, await res.text());
      }
    }
  }

  // Always clean up the mapping row regardless of API outcome.
  await admin
    .from("booking_member_calendar_events" as never)
    .delete()
    .eq("booking_id" as never, bookingId)
    .eq("membership_id" as never, membershipId);

  return true;
}

// ---------------------------------------------------------------------------
// Sync: called after every booking assignee change
// ---------------------------------------------------------------------------

/**
 * Sync personal-calendar events for all currently-assigned members.
 *
 * Idempotent — safe to call on every booking create/update:
 *  • Assignees WITH a connection:  create or update their event
 *  • Previous assignees no longer in the list:  delete their event
 *
 * Fire-and-forget: individual failures are swallowed so booking saves
 * complete even when GCal is unreachable.
 */
export async function syncMemberCalendarEvents(
  bookingId: string,
  assigneeIds: string[], // membership IDs currently assigned
  booking: BookingForMemberEvent,
): Promise<void> {
  const admin = createSupabaseAdminClient();

  // 1. All existing member event rows for this booking.
  const { data: existingRows } = (await admin
    .from("booking_member_calendar_events" as never)
    .select("membership_id, google_calendar_event_id")
    .eq("booking_id" as never, bookingId)) as unknown as {
    data: Array<{ membership_id: string; google_calendar_event_id: string }> | null;
  };

  const existingSet = new Set((existingRows ?? []).map((r) => r.membership_id));
  const assigneeSet = new Set(assigneeIds);

  // Fetch segment metadata for all assignees on this booking so split
  // employees get a calendar event for their own segment, not the full job.
  const { data: segmentRows } = (await admin
    .from("booking_assignees" as never)
    .select("membership_id, split_start_offset_minutes, split_duration_minutes")
    .eq("booking_id" as never, bookingId as never)
    .in("membership_id" as never, assigneeIds as never)) as unknown as {
    data: Array<{
      membership_id: string;
      split_start_offset_minutes: number | null;
      split_duration_minutes: number | null;
    }> | null;
  };

  const segmentByMember = new Map(
    (segmentRows ?? []).map((r) => [r.membership_id, r]),
  );

  // Build a per-member adjusted booking payload (segment-specific for
  // split employees, full booking for regular employees).
  function adjustedBooking(mid: string): BookingForMemberEvent {
    const seg = segmentByMember.get(mid);
    if (seg?.split_start_offset_minutes != null && seg.split_duration_minutes != null) {
      return {
        ...booking,
        scheduled_at: new Date(
          new Date(booking.scheduled_at).getTime() + seg.split_start_offset_minutes * 60_000,
        ).toISOString(),
        duration_minutes: seg.split_duration_minutes,
      };
    }
    return booking;
  }

  // 2. Upsert events for all current assignees who have a personal connection.
  const upsertTasks = assigneeIds.map(async (mid) => {
    const payload = adjustedBooking(mid);
    if (existingSet.has(mid)) {
      await updateMemberCalendarEvent(mid, payload).catch(() => {});
    } else {
      await createMemberCalendarEvent(mid, payload).catch(() => {});
    }
  });

  // 3. Delete events for members who were removed from the booking.
  const deleteTasks = (existingRows ?? [])
    .filter((r) => !assigneeSet.has(r.membership_id))
    .map((r) => deleteMemberCalendarEvent(r.membership_id, bookingId).catch(() => {}));

  await Promise.allSettled([...upsertTasks, ...deleteTasks]);
}

/**
 * Delete personal-calendar events for a member and clean up the mapping
 * table. Called when a member disconnects their calendar.
 *
 * Scope: we attempt to delete every event we have a mapping row for,
 * not just upcoming. Previously the query was scoped to upcoming
 * (`bookings.scheduled_at >= now`) but then the mapping rows for ALL
 * events were deleted at the end — past events were never DELETE'd
 * from Google and their event IDs vanished from our tracker, leaving
 * months of orphaned "cleaning" events on the cleaner's calendar with
 * no way for us to clean them up later.
 *
 * Now we walk every mapping row and attempt a DELETE on each. Google
 * 404s for events the user already removed manually — those are
 * swallowed. Then the mapping rows are dropped.
 */
export async function cleanupMemberCalendarEvents(
  membershipId: string,
): Promise<void> {
  const conn = await getMemberConnection(membershipId);
  const admin = createSupabaseAdminClient();

  const { data: rows } = (await admin
    .from("booking_member_calendar_events" as never)
    .select("booking_id, google_calendar_event_id")
    .eq("membership_id" as never, membershipId)) as unknown as {
    data: Array<{
      booking_id: string;
      google_calendar_event_id: string;
    }> | null;
  };

  if (conn && rows && rows.length > 0) {
    const calendarId = (conn.metadata?.calendar_id as string) || "primary";
    // Batch the DELETEs to avoid hammering the Google Calendar API for
    // members with many historical events (a year of weekly jobs ≈ 52).
    const BATCH = 10;
    for (let i = 0; i < rows.length; i += BATCH) {
      await Promise.allSettled(
        rows.slice(i, i + BATCH).map((r) =>
          gcalFetch(
            conn.access_token,
            `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(r.google_calendar_event_id)}`,
            { method: "DELETE" },
          ).catch(() => {}),
        ),
      );
    }
  }

  // Remove all mapping rows for this member (past and upcoming).
  await admin
    .from("booking_member_calendar_events" as never)
    .delete()
    .eq("membership_id" as never, membershipId);
}

/**
 * On connect: push all upcoming bookings assigned to this member to their
 * newly-connected personal calendar.
 * Only syncs bookings that don't already have a mapping row.
 */
export async function bulkSyncMemberBookings(
  membershipId: string,
): Promise<void> {
  const conn = await getMemberConnection(membershipId);
  if (!conn) return;

  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();

  // Fetch upcoming assigned bookings without an existing member event.
  // Pull split metadata too so split-segment employees get an event for
  // their segment window only — not the full booking duration.
  const { data: bookings } = (await admin
    .from("booking_assignees" as never)
    .select(
      `membership_id, split_start_offset_minutes, split_duration_minutes,
       booking:bookings!inner(
         id, scheduled_at, duration_minutes, service_type, address, notes, status,
         client:clients!inner(name)
       )`,
    )
    .eq("membership_id" as never, membershipId)
    .neq("booking.status" as never, "cancelled" as never)
    .gte("booking.scheduled_at" as never, now as never)
    .limit(500)) as unknown as {
    data: Array<{
      membership_id: string;
      split_start_offset_minutes: number | null;
      split_duration_minutes: number | null;
      booking: {
        id: string;
        scheduled_at: string;
        duration_minutes: number;
        service_type: string;
        address: string | null;
        notes: string | null;
        status: string;
        client: { name: string } | null;
      };
    }> | null;
  };

  if (!bookings || bookings.length === 0) return;

  // Find which booking IDs already have a member event (don't double-create).
  const bookingIds = bookings.map((b) => b.booking.id);
  const { data: existingMappings } = (await admin
    .from("booking_member_calendar_events" as never)
    .select("booking_id")
    .eq("membership_id" as never, membershipId)
    .in("booking_id" as never, bookingIds as never)) as unknown as {
    data: Array<{ booking_id: string }> | null;
  };
  const alreadySynced = new Set((existingMappings ?? []).map((r) => r.booking_id));

  const toSync = bookings.filter((b) => !alreadySynced.has(b.booking.id));
  if (toSync.length === 0) return;

  const BATCH = 10;
  for (let i = 0; i < toSync.length; i += BATCH) {
    await Promise.allSettled(
      toSync.slice(i, i + BATCH).map((b) => {
        // For split-segment employees, adjust start time and duration to
        // their segment window. Non-split rows have null offset/duration
        // and fall through to the full booking values.
        const segOffset = b.split_start_offset_minutes;
        const segDuration = b.split_duration_minutes;
        const scheduled_at =
          segOffset != null
            ? new Date(
                new Date(b.booking.scheduled_at).getTime() +
                  segOffset * 60_000,
              ).toISOString()
            : b.booking.scheduled_at;
        const duration_minutes = segDuration ?? b.booking.duration_minutes;
        return createMemberCalendarEvent(membershipId, {
          id: b.booking.id,
          scheduled_at,
          duration_minutes,
          service_type: b.booking.service_type,
          address: b.booking.address,
          notes: b.booking.notes,
          client_name: b.booking.client?.name,
        }).catch(() => {});
      }),
    );
  }
}
