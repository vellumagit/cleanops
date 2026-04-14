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
    prompt: "consent",
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
// Core: get a valid access token for an org
// ---------------------------------------------------------------------------

/**
 * Get an active Google Calendar connection for an org. Returns null if
 * there isn't one.
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

  // Store the event ID on the booking
  const admin = createSupabaseAdminClient();
  await admin
    .from("bookings")
    .update({ google_calendar_event_id: eventId } as never)
    .eq("id", booking.id);

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
 * Check if an org has an active Google Calendar connection.
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
    .eq("status" as never, "active");
  return (count ?? 0) > 0;
}
