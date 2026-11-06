/**
 * One message per fact. notify() with a `fact` writes one row per person per
 * fact — the database's unique index decides — and pushes or emails only the
 * people whose row went in. So one tick, two code paths, or a retried cron
 * cannot tell one person twice about one job. The database is a small fake
 * that enforces the same unique index as migration 20261107010000.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { organization_id: string; recipient_membership_id: string | null; fact?: string | null; title: string };

const table: Row[] = [];
const members = [
  { id: "svitlana", organization_id: "org", role: "owner", status: "active" },
  { id: "olha", organization_id: "org", role: "manager", status: "active" },
  { id: "vira", organization_id: "org", role: "employee", status: "active" },
];
const push = vi.fn(async (_id: string, _p: unknown) => 1);
const email = vi.fn(async (_org: string, _m: unknown) => ({ ok: true }));

/** Just enough of PostgREST: memberships by role, notifications insert/upsert. */
function fakeDb() {
  const chain = (table_: string) => {
    const filters: Array<(m: Record<string, unknown>) => boolean> = [];
    let pendingRows: Row[] | null = null;
    let ignoreDuplicates = false;
    let selecting = false;
    const run = () => {
      if (table_ === "memberships") {
        const data = members.filter((m) => filters.every((f) => f(m)));
        return { data: selecting ? data : data, error: null };
      }
      if (table_ === "notifications" && pendingRows) {
        const inserted: Row[] = [];
        for (const r of pendingRows) {
          const dup =
            r.fact != null &&
            r.recipient_membership_id != null &&
            table.some(
              (t) =>
                t.organization_id === r.organization_id &&
                t.recipient_membership_id === r.recipient_membership_id &&
                t.fact === r.fact,
            );
          if (dup) {
            if (ignoreDuplicates) continue;
            return { data: null, error: { message: "duplicate key value violates unique constraint" } };
          }
          table.push(r);
          inserted.push(r);
        }
        return { data: inserted, error: null };
      }
      return { data: null, error: null };
    };
    const b: Record<string, unknown> = {
      select: (cols?: string) => {
        selecting = true;
        // staffEmail selects display_name etc. and maybeSingle()s; give it nothing
        // so email falls back to "no email" unless a test wants it.
        void cols;
        return b;
      },
      eq: (col: string, v: unknown) => {
        filters.push((m) => m[col] === v);
        return b;
      },
      in: (col: string, vs: unknown[]) => {
        filters.push((m) => vs.includes(m[col]));
        return b;
      },
      insert: (rows: Row[]) => {
        pendingRows = rows;
        return b;
      },
      upsert: (rows: Row[], opts?: { ignoreDuplicates?: boolean }) => {
        pendingRows = rows;
        ignoreDuplicates = opts?.ignoreDuplicates === true;
        return b;
      },
      maybeSingle: () => ({ then: (res: (v: unknown) => unknown) => res({ data: null, error: null }) }),
      then: (res: (v: unknown) => unknown) => res(run()),
    };
    return b;
  };
  return { from: (t: string) => chain(t) };
}

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => fakeDb() }));
vi.mock("@/lib/push", () => ({
  sendPushToMembership: (id: string, p: unknown) => push(id, p),
  sendPushToOrg: async () => 0,
}));
vi.mock("@/lib/email", () => ({ sendOrgEmail: (org: string, m: unknown) => email(org, m) }));
vi.mock("@/lib/email-templates", () => ({
  renderStaffAlertEmail: () => ({ subject: "s", html: "h", text: "t" }),
}));

const { notify } = await import("@/lib/notify");

const base = { organizationId: "org", title: "A job finished with no clock-in", body: "Ranj Asi", href: "/app/bookings/x" };

describe("one message per fact", () => {
  beforeEach(() => {
    table.length = 0;
    push.mockClear();
    email.mockClear();
  });

  it("the same fact twice to one person is one row and one push", async () => {
    await notify({ ...base, audience: "membership", membershipId: "vira", fact: "no_clock_in:job1" });
    await notify({ ...base, audience: "membership", membershipId: "vira", fact: "no_clock_in:job1" });
    expect(table).toHaveLength(1);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("two code paths reaching management about one job tell each manager once", async () => {
    await notify({ ...base, audience: "org-management", fact: "no_clock_in:job1" });
    await notify({ ...base, audience: "org-management", fact: "no_clock_in:job1", title: "Same fact, other sender" });
    expect(table.map((r) => r.recipient_membership_id).sort()).toEqual(["olha", "svitlana"]);
    expect(push).toHaveBeenCalledTimes(2);
  });

  it("a person who was told earlier is skipped; the others still hear it", async () => {
    await notify({ ...base, audience: "membership", membershipId: "olha", fact: "no_clock_in:job1" });
    push.mockClear();
    await notify({ ...base, audience: "org-management", fact: "no_clock_in:job1" });
    expect(table.filter((r) => r.recipient_membership_id === "olha")).toHaveLength(1);
    expect(push.mock.calls.map((c) => c[0])).toEqual(["svitlana"]);
  });

  it("a different fact about the same job goes through", async () => {
    await notify({ ...base, audience: "membership", membershipId: "vira", fact: "assigned:job1:2026-11-05T15:00:00Z" });
    await notify({ ...base, audience: "membership", membershipId: "vira", fact: "assigned:job1:2026-11-06T15:00:00Z" });
    expect(table).toHaveLength(2);
  });

  it("no fact, no dedupe — a repeating reminder still repeats", async () => {
    await notify({ ...base, audience: "membership", membershipId: "vira", type: "clock_out_reminder" });
    await notify({ ...base, audience: "membership", membershipId: "vira", type: "clock_out_reminder" });
    expect(table).toHaveLength(2);
    expect(push).toHaveBeenCalledTimes(2);
  });

  it("the email channel follows the same rule", async () => {
    const seen: string[] = [];
    email.mockImplementation(async (_org: string, m: unknown) => {
      seen.push(String((m as { to: string }).to));
      return { ok: true };
    });
    // staffEmail finds no address in this fake, so the email path is reached
    // but logs "no email"; what matters is how many recipients it was asked for.
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await notify({ ...base, audience: "org-management", fact: "f", channels: { email: true } });
    const first = err.mock.calls.filter((c) => String(c[0]).includes("no email")).length;
    await notify({ ...base, audience: "org-management", fact: "f", channels: { email: true } });
    const second = err.mock.calls.filter((c) => String(c[0]).includes("no email")).length - first;
    err.mockRestore();
    expect(first).toBe(2);
    expect(second).toBe(0);
    expect(seen).toEqual([]);
  });
});
