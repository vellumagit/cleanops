/**
 * A stand-in for Google Calendar, for the tests that run the app's calendar
 * code against the real database.
 *
 * It answers the calls src/lib/google-calendar.ts makes, the way Google does:
 * list a window of events (paged, so a long calendar is read across pages),
 * create, read, patch and delete one event, and refresh a token. Each access
 * token is its own calendar, so a company's calendar and each cleaner's are
 * kept apart, as they are at Google. Everything else goes to the real fetch.
 *
 * It keeps no policies and no quotas. A test here proves what the app asked
 * Google to do and what it did with the answers.
 */

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export type FakeEvent = {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  colorId?: string;
  start: { dateTime: string };
  end: { dateTime: string };
  status: "confirmed";
};

export type FakeGoogle = {
  /** Calendars by "token|calendarId"; events by id. */
  calendars: Map<string, Map<string, FakeEvent>>;
  /** One calendar, made if needed. */
  calendar: (token: string, calendarId?: string) => Map<string, FakeEvent>;
  /** Put an event straight on a calendar, as if someone made it earlier. */
  put: (token: string, event: Omit<FakeEvent, "id" | "status"> & { id?: string }, calendarId?: string) => FakeEvent;
  /** Every call made, "METHOD path". */
  calls: string[];
  /** Items per list page. Small, so paging is exercised. */
  pageSize: number;
  restore: () => void;
};

export function installFakeGoogleCalendar(): FakeGoogle {
  const realFetch = globalThis.fetch;
  const calendars = new Map<string, Map<string, FakeEvent>>();
  const calls: string[] = [];
  let next = 0;
  const calendar = (token: string, calendarId = "primary") => {
    const key = `${token}|${calendarId}`;
    let c = calendars.get(key);
    if (!c) {
      c = new Map();
      calendars.set(key, c);
    }
    return c;
  };
  const fake: FakeGoogle = {
    calendars,
    calendar,
    calls,
    pageSize: 50,
    put: (token, event, calendarId = "primary") => {
      const e: FakeEvent = { ...event, id: event.id ?? `evt${++next}`, status: "confirmed" };
      calendar(token, calendarId).set(e.id, e);
      return e;
    },
    restore: () => {
      globalThis.fetch = realFetch;
    },
  };

  const json = (status: number, body: unknown) =>
    new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();

    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      calls.push(`${method} token`);
      return json(200, { access_token: `refreshed-${++next}`, expires_in: 3600 });
    }
    if (!url.startsWith(CALENDAR_API)) return realFetch(input, init);

    const u = new URL(url);
    const path = decodeURIComponent(u.pathname.slice("/calendar/v3".length));
    calls.push(`${method} ${path}`);
    const headers = new Headers(init?.headers);
    const token = (headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json(401, { error: { code: 401, message: "Login Required" } });

    const m = /^\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(path);
    if (!m) return json(404, { error: { code: 404, message: `fake has no ${path}` } });
    const cal = calendar(token, m[1]);
    const eventId = m[2];
    const body = init?.body ? (JSON.parse(String(init.body)) as Partial<FakeEvent>) : {};

    if (!eventId && method === "GET") {
      const timeMin = u.searchParams.get("timeMin");
      const timeMax = u.searchParams.get("timeMax");
      const from = Number(u.searchParams.get("pageToken") ?? 0);
      const inWindow = [...cal.values()]
        .filter((e) => (!timeMin || e.end.dateTime > timeMin) && (!timeMax || e.start.dateTime < timeMax))
        .sort((a, b) => a.start.dateTime.localeCompare(b.start.dateTime) || a.id.localeCompare(b.id));
      const size = Math.min(fake.pageSize, Number(u.searchParams.get("maxResults") ?? 250));
      const page = inWindow.slice(from, from + size);
      return json(200, { items: page, ...(from + size < inWindow.length ? { nextPageToken: String(from + size) } : {}) });
    }
    if (!eventId && method === "POST") {
      const e: FakeEvent = { ...(body as FakeEvent), id: `evt${++next}`, status: "confirmed" };
      cal.set(e.id, e);
      return json(200, e);
    }
    if (eventId) {
      const existing = cal.get(eventId);
      if (method === "GET") return existing ? json(200, existing) : json(404, { error: { code: 404, message: "Not Found" } });
      if (method === "PATCH" || method === "PUT") {
        if (!existing) return json(404, { error: { code: 404, message: "Not Found" } });
        const updated = { ...existing, ...body, id: existing.id, status: "confirmed" as const };
        cal.set(eventId, updated);
        return json(200, updated);
      }
      if (method === "DELETE") {
        if (!existing) return json(410, { error: { code: 410, message: "Resource has been deleted" } });
        cal.delete(eventId);
        return json(204, null);
      }
    }
    return json(405, { error: { code: 405, message: `fake has no ${method} ${path}` } });
  }) as typeof fetch;

  return fake;
}
