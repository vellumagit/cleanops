import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  Banknote,
  Calendar,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  GraduationCap,
  MapPin,
  RefreshCw,
  Shield,
  XCircle,
} from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { FieldHeader } from "@/components/field-shell";
import { ProfileForm } from "./profile-form";
import { CalendarScopeForm } from "./calendar-scope-form";
import { PushToggle } from "@/components/push-prompt";
import { formatDateTime } from "@/lib/format";
import {
  connectMyGoogleCalendarAction,
  disconnectMyGoogleCalendarAction,
  resyncMyGoogleCalendarAction,
} from "./actions";
import { getOrgTimezone } from "@/lib/org-timezone";

export const metadata = { title: "Profile" };

/** Small uppercase label that turns the stack into named groups. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 mt-6 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h2>
  );
}

/** One tappable row: icon, title, optional hint/badge, chevron. */
function NavRow({
  href,
  icon: Icon,
  title,
  hint,
  badge,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  hint?: string;
  badge?: string | null;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 border-b border-border/60 px-4 py-3.5 transition-colors last:border-b-0 active:bg-muted"
    >
      <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{title}</span>
        {hint && (
          <span className="block text-xs text-muted-foreground">{hint}</span>
        )}
      </span>
      {badge && (
        <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
          {badge}
        </span>
      )}
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
    </Link>
  );
}

export default async function FieldProfilePage() {
  const membership = await requireMembership();
  const tz = await getOrgTimezone(membership.organization_id);
  const supabase = await createSupabaseServerClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, phone")
    .eq("id", membership.profile_id)
    .maybeSingle();

  // Personal calendar scope + highlight color (managers can mirror the whole
  // org).
  const { data: calPrefs } = (await supabase
    .from("memberships")
    .select("calendar_scope, calendar_color" as never)
    .eq("id", membership.id)
    .maybeSingle()) as unknown as {
    data: {
      calendar_scope: string | null;
      calendar_color: string | null;
    } | null;
  };
  const calScope = calPrefs?.calendar_scope ?? "mine";
  const calColor = calPrefs?.calendar_color ?? "6";
  const isManagerPlus = ["owner", "admin", "manager"].includes(membership.role);

  const admin = createSupabaseAdminClient();
  const [{ count: pendingPto }, { data: gcalConn }] = await Promise.all([
    // Pending time-off count — surfaces on the Time off row so an open
    // request is visible without opening the page.
    admin
      .from("pto_requests" as never)
      .select("id", { count: "exact", head: true })
      .eq("employee_id" as never, membership.id as never)
      .eq("status" as never, "pending" as never) as unknown as Promise<{
      count: number | null;
    }>,

    // Personal GCal connection, if any.
    admin
      .from("integration_connections" as never)
      .select("external_account_id, connected_at, scope")
      .eq("membership_id" as never, membership.id)
      .eq("provider" as never, "google_calendar")
      .eq("status" as never, "active")
      .maybeSingle() as unknown as Promise<{
      data: {
        external_account_id: string | null;
        connected_at: string;
        scope: string | null;
      } | null;
    }>,
  ]);

  // A connection can be "active" (token refreshes) yet useless if the user
  // unchecked Calendar access on Google's consent screen — every event write
  // then 403s. Detect that so we can prompt a reconnect instead of showing a
  // misleading green "Connected".
  const calendarGranted = (gcalConn?.scope ?? "").includes("calendar");

  return (
    <>
      <FieldHeader
        title="Profile"
        description="Your details, your money, and how the app reaches you."
      />

      {/* ── Who you are ── */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="mb-5 flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-xl font-bold">
            {(profile?.full_name ?? "U").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="truncate text-lg font-bold">
              {profile?.full_name ?? "Unnamed crew"}
            </div>
            <div className="text-sm uppercase tracking-wide text-muted-foreground">
              {membership.role} · {membership.organization_name}
            </div>
          </div>
        </div>

        <ProfileForm
          defaults={{
            full_name: profile?.full_name ?? "",
            phone: profile?.phone ?? "",
          }}
        />
      </div>

      {/* ── My work — the things a cleaner actually checks ── */}
      <SectionLabel>My work</SectionLabel>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <NavRow
          href="/field/pay"
          icon={Banknote}
          title="My pay"
          hint="This period so far, and every statement"
        />
        <NavRow
          href="/field/hours"
          icon={CalendarDays}
          title="My hours"
          hint="Every shift you've recorded"
        />
        <NavRow
          href="/field/availability"
          icon={CalendarClock}
          title="My availability"
          hint="The hours you can work — shows on the office schedule"
        />
        <NavRow
          href="/field/time-off"
          icon={Calendar}
          title="Time off"
          hint="Request days off and track approvals"
          badge={
            pendingPto
              ? `${pendingPto} pending`
              : null
          }
        />
        <NavRow
          href="/field/training"
          icon={GraduationCap}
          title="Training modules"
          hint="Work through what's assigned to you"
        />
      </div>

      {/* ── Notifications & calendar — how the app reaches you ── */}
      <SectionLabel>Notifications &amp; calendar</SectionLabel>
      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="mb-3 text-sm font-semibold">Push notifications</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Get alerts on this device for new jobs, messages, and schedule changes
          — even when the app is in the background.
        </p>
        <PushToggle
          membershipId={membership.id}
          organizationId={membership.organization_id}
        />
      </div>

      <div className="mt-3 rounded-xl border border-border bg-card p-5">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <CalendarDays className="h-4 w-4 text-blue-500" />
          Google Calendar
        </h3>
        <p className="mb-4 text-xs text-muted-foreground leading-relaxed">
          Connect your personal Google Calendar to automatically see your
          assigned jobs. Events are created, updated, and removed as your
          schedule changes.
        </p>

        {gcalConn && !calendarGranted ? (
          // Connected, but Calendar permission was NOT granted — events will
          // never sync. Prompt a reconnect with the permission checked.
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs">
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
              <div className="min-w-0 flex-1 text-amber-800 dark:text-amber-200">
                {gcalConn.external_account_id && (
                  <div className="truncate font-medium">
                    {gcalConn.external_account_id}
                  </div>
                )}
                <div>
                  Calendar access wasn&rsquo;t granted, so your jobs can&rsquo;t
                  sync. Reconnect and keep the{" "}
                  <span className="font-medium">Google Calendar</span> checkbox
                  ticked on the permission screen.
                </div>
              </div>
            </div>
            <form action={connectMyGoogleCalendarAction}>
              <button
                type="submit"
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-foreground px-3 py-2.5 text-sm font-medium text-background transition-colors hover:bg-foreground/90 active:scale-95"
              >
                <CalendarDays className="h-4 w-4" />
                Reconnect &amp; allow Calendar
              </button>
            </form>
            <form action={disconnectMyGoogleCalendarAction}>
              <button
                type="submit"
                className="inline-flex w-full items-center justify-center gap-1 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
              >
                <XCircle className="h-3.5 w-3.5" />
                Disconnect
              </button>
            </form>
          </div>
        ) : gcalConn ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
              <div className="min-w-0 flex-1">
                {gcalConn.external_account_id && (
                  <div className="truncate font-medium">
                    {gcalConn.external_account_id}
                  </div>
                )}
                <div className="text-muted-foreground">
                  Connected {formatDateTime(gcalConn.connected_at, tz)}
                </div>
              </div>
            </div>
            <form action={resyncMyGoogleCalendarAction}>
              <button
                type="submit"
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted active:scale-95"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Re-sync upcoming jobs
              </button>
            </form>
            <div className="flex gap-2">
              <form action={connectMyGoogleCalendarAction} className="flex-1">
                <button
                  type="submit"
                  className="inline-flex w-full items-center justify-center rounded-md bg-foreground px-3 py-2 text-xs font-medium text-background transition-colors hover:bg-foreground/90 active:scale-95"
                >
                  Switch account
                </button>
              </form>
              <form
                action={disconnectMyGoogleCalendarAction}
                className="flex-1"
              >
                <button
                  type="submit"
                  className="inline-flex w-full items-center justify-center gap-1 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
                >
                  <XCircle className="h-3.5 w-3.5" />
                  Disconnect
                </button>
              </form>
            </div>

            {/* Managers can mirror the whole org, with their jobs highlighted. */}
            {isManagerPlus && (
              <div className="border-t border-border pt-3">
                <h4 className="mb-1 text-sm font-semibold">Calendar view</h4>
                <p className="mb-3 text-xs text-muted-foreground">
                  Show only your own jobs, or the whole team&apos;s schedule
                  with your jobs highlighted in your color.
                </p>
                <CalendarScopeForm scope={calScope} color={calColor} />
              </div>
            )}
          </div>
        ) : (
          <form action={connectMyGoogleCalendarAction}>
            <button
              type="submit"
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-foreground px-3 py-2.5 text-sm font-medium text-background transition-colors hover:bg-foreground/90 active:scale-95"
            >
              <CalendarDays className="h-4 w-4" />
              Connect Google Calendar
            </button>
          </form>
        )}
      </div>

      {/* ── Account & privacy ── */}
      <SectionLabel>Account &amp; privacy</SectionLabel>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <NavRow
          href="/field/profile/security"
          icon={Shield}
          title="Security"
          hint="Add a second factor to your sign-in"
        />
      </div>
      <div className="mt-3 rounded-xl border border-border bg-card p-4">
        <p className="flex items-start gap-2 text-xs text-muted-foreground leading-relaxed">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            When you clock in or out of a job your GPS coordinates are recorded
            to confirm on-site presence. This data is visible only to your
            employer and is never shared with third parties.
          </span>
        </p>
      </div>
    </>
  );
}
