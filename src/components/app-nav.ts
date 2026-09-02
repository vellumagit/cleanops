import {
  LayoutDashboard,
  BookUser,
  Calendar,
  CalendarCheck,
  CalendarDays,
  Clock,
  FileText,
  ScrollText,
  Users,
  UserRound,
  UserPlus,
  Star,
  Award,
  Receipt,
  GraduationCap,
  Boxes,
  ClipboardCheck,
  ClipboardList,
  CheckSquare,
  MessageSquare,
  MessageSquareWarning,
  Rss,
  Settings,
  Bell,
  LifeBuoy,
  BarChart3,
  Banknote,
  Inbox,
} from "lucide-react";
import { hasCapability, type CapabilityKey, type CapabilityMap } from "@/lib/capabilities";

/**
 * THE nav manifest — the single source of truth for every admin
 * destination, consumed by the desktop sidebar, the phone tab bar, the
 * phone "More" sheet, and the desktop-tool ribbon. One list, so the
 * surfaces can never drift: add a page here once and every menu agrees.
 *
 * mobileTier is the phone story ("condense by curation, not forking"):
 *   core    — lives on the bottom tab bar; the on-the-go core.
 *   more    — in the More sheet; works fine on a phone, not front-line.
 *   desktop — collapsed under "Desktop tools" in the More sheet, and the
 *             page shows a "built for a bigger screen" ribbon. Still
 *             fully functional — discouraged, never blocked.
 */

export type MobileTier = "core" | "more" | "desktop";

export type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Roles that can see this item. If omitted, visible to all. */
  roles?: string[];
  /** Manager capability this item needs. Owners/admins always pass; a
   *  manager without it never sees the link, so the nav matches what the
   *  page would actually let them open. */
  capability?: CapabilityKey;
  mobileTier: MobileTier;
};

export type NavSection = {
  label: string;
  items: NavItem[];
  /** Accent colour for this section's icons */
  accent: string;
  /** Active tab background tint */
  activeBg: string;
};

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Overview",
    accent: "text-zinc-300",
    activeBg: "bg-zinc-800",
    items: [
      { href: "/app", label: "Dashboard", icon: LayoutDashboard, mobileTier: "core" },
    ],
  },
  {
    label: "Operations",
    accent: "text-sky-400",
    activeBg: "bg-sky-500/10",
    items: [
      { href: "/app/bookings", label: "Bookings", icon: CalendarCheck, mobileTier: "core" },
      { href: "/app/calendar", label: "Calendar", icon: CalendarDays, capability: "scheduling" as const, mobileTier: "more" },
      { href: "/app/scheduling", label: "Scheduling", icon: Calendar, roles: ["owner", "admin", "manager"], capability: "scheduling" as const, mobileTier: "core" },
      { href: "/app/bookings/requests", label: "Requests", icon: Inbox, roles: ["owner", "admin", "manager"], mobileTier: "core" },
      { href: "/app/estimates", label: "Estimates", icon: FileText, roles: ["owner", "admin", "manager"], capability: "invoicing" as const, mobileTier: "more" },
      { href: "/app/contracts", label: "Contracts", icon: ScrollText, roles: ["owner", "admin", "manager"], mobileTier: "desktop" },
      { href: "/app/checklists", label: "Checklists", icon: ClipboardCheck, roles: ["owner", "admin", "manager"], mobileTier: "desktop" },
      { href: "/app/tasks", label: "Tasks", icon: CheckSquare, mobileTier: "more" },
      { href: "/app/inventory", label: "Inventory", icon: Boxes, mobileTier: "more" },
    ],
  },
  {
    label: "People",
    accent: "text-violet-400",
    activeBg: "bg-violet-500/10",
    items: [
      // Leads sits ABOVE Clients: it's the same people one step earlier, and
      // the order matches the direction they travel.
      { href: "/app/leads", label: "Leads", icon: UserPlus, roles: ["owner", "admin", "manager"], capability: "clients" as const, mobileTier: "more" },
      { href: "/app/clients", label: "Clients", icon: Users, roles: ["owner", "admin", "manager"], capability: "clients" as const, mobileTier: "more" },
      { href: "/app/employees", label: "Employees", icon: UserRound, roles: ["owner", "admin"], mobileTier: "more" },
      // PURELY A SOURCING TOOL: "who can I text tonight". Contractor pay used
      // to hang off this entry, which filed a paying concept inside a hiring
      // one — a roster subcontractor who had never touched the bench still had
      // their pay living here. It now sits under Payroll as a peer of
      // employee pay, which is the split that actually matters (engagement,
      // and therefore tax treatment). Where someone was sourced changes
      // nothing about how they are paid.
      //
      // The naming still earns its keep: "Subcontractors" sent owners here
      // looking for their own crew, and "Outsourcing" read like a service
      // Sollos sells. Roster subcontractors live under Employees and get shift
      // offers through the same Offer flow.
      { href: "/app/freelancers", label: "On-call pool", icon: UserPlus, roles: ["owner", "admin", "manager"], capability: "subcontractors" as const, mobileTier: "more" },
      // The rolodex: realtors, property managers, suppliers — people who
      // matter but aren't clients (and never will be: no bookings, no
      // invoices). Sits after the work roster, before reputation.
      { href: "/app/network", label: "Network", icon: BookUser, roles: ["owner", "admin", "manager"], mobileTier: "more" },
      { href: "/app/reviews", label: "Reviews", icon: Star, mobileTier: "more" },
      { href: "/app/bonuses", label: "Bonuses", icon: Award, mobileTier: "more" },
    ],
  },
  {
    // Hiring is its own lane — Brian: applicants, the hiring library
    // (questionnaires + procedures you work FROM before the yes), and
    // Training (what a new employee works THROUGH after it).
    label: "Hiring",
    accent: "text-rose-400",
    activeBg: "bg-rose-500/10",
    items: [
      { href: "/app/applicants", label: "Applicants", icon: ClipboardList, roles: ["owner", "admin"], mobileTier: "desktop" },
      { href: "/app/hiring", label: "Hiring", icon: UserPlus, roles: ["owner", "admin"], mobileTier: "desktop" },
      { href: "/app/training", label: "Training", icon: GraduationCap, mobileTier: "desktop" },
    ],
  },
  {
    label: "Money",
    accent: "text-emerald-400",
    activeBg: "bg-emerald-500/10",
    items: [
      { href: "/app/invoices", label: "Invoices", icon: Receipt, roles: ["owner", "admin", "manager"], capability: "invoicing" as const, mobileTier: "more" },
      // Timesheets sits with the money, not the people: hours are the raw
      // material of payroll, and the two now share one pay-period calendar.
      // Brian: "I think that makes more sense." Above Payroll — the order
      // work flows: hours → review → run.
      { href: "/app/timesheets", label: "Timesheets", icon: Clock, roles: ["owner", "admin", "manager"], capability: "timesheets" as const, mobileTier: "more" },
      { href: "/app/payroll", label: "Payroll", icon: Banknote, roles: ["owner", "admin"], mobileTier: "desktop" },
      { href: "/app/reports", label: "Reports", icon: BarChart3, roles: ["owner", "admin"], mobileTier: "desktop" },
    ],
  },
  {
    label: "Comms",
    accent: "text-amber-400",
    activeBg: "bg-amber-500/10",
    items: [
      { href: "/app/feed", label: "Feed", icon: Rss, mobileTier: "more" },
      { href: "/app/chat", label: "Chat", icon: MessageSquare, mobileTier: "more" },
    ],
  },
];

export const FOOTER_NAV: NavItem[] = [
  { href: "/app/help", label: "Help", icon: LifeBuoy, mobileTier: "more" },
  // Sits next to Help because it is the other half of the same question:
  // Help answers what the app already does, Feedback is where you go when
  // the answer is "it doesn't", or "it did the wrong thing". No roles gate —
  // a cleaner hitting a bug in the field files the report nobody else can.
  { href: "/app/feedback", label: "Feedback", icon: MessageSquareWarning, mobileTier: "more" },
  { href: "/app/notifications", label: "Notifications", icon: Bell, mobileTier: "more" },
  { href: "/app/settings", label: "Settings", icon: Settings, roles: ["owner", "admin"], mobileTier: "desktop" },
];

/** Badge labels for specific tabs */
export const BADGE_LABELS: Record<string, string> = {
  "/app/bookings": "today",
  "/app/bookings/requests": "pending",
  "/app/invoices": "overdue",
  "/app/estimates": "pending",
  "/app/chat": "new",
  "/app/reviews": "this week",
  "/app/applicants": "new",
};

/** The phone tab bar: the core tier, in thumb order. The More tab is
 *  rendered by the bar itself and opens the sheet with everything else. */
export const MOBILE_TABS: NavItem[] = [
  { href: "/app", label: "Today", icon: LayoutDashboard, mobileTier: "core" },
  { href: "/app/scheduling", label: "Schedule", icon: Calendar, roles: ["owner", "admin", "manager"], capability: "scheduling" as const, mobileTier: "core" },
  { href: "/app/bookings", label: "Bookings", icon: CalendarCheck, mobileTier: "core" },
  { href: "/app/bookings/requests", label: "Requests", icon: Inbox, roles: ["owner", "admin", "manager"], mobileTier: "core" },
];

/** Shared visibility rule — the sidebar, tab bar, and More sheet must
 *  never disagree about who sees a link. */
export function navItemVisible(
  item: NavItem,
  role: string,
  capabilities: CapabilityMap,
  feedEnabled: boolean,
): boolean {
  if (!feedEnabled && item.href === "/app/feed") return false;
  if (item.roles && !item.roles.includes(role)) return false;
  if (item.capability && !hasCapability(role, capabilities, item.capability)) {
    return false;
  }
  return true;
}

/** "Longest prefix wins" — prevents /app/bookings from reading active
 *  while the user is on /app/bookings/requests (a deeper nav item). */
export function bestNavMatch(pathname: string, hrefs: string[]): string {
  return (
    hrefs
      .filter((h) =>
        h === "/app"
          ? pathname === "/app"
          : pathname === h || pathname.startsWith(h + "/"),
      )
      .sort((a, b) => b.length - a.length)[0] ?? ""
  );
}

/** Every href in the manifest, for active-state matching. */
export function allNavHrefs(): string[] {
  return [
    ...NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.href)),
    ...FOOTER_NAV.map((i) => i.href),
  ];
}

/** The tier of the manifest entry the current path belongs to, or null
 *  when the path isn't a manifest destination (detail pages inherit the
 *  tier of their longest-prefix parent, which is what we want: a payroll
 *  run page is as desktop-shaped as the payroll page itself). */
export function tierForPath(pathname: string): MobileTier | null {
  const match = bestNavMatch(pathname, allNavHrefs());
  if (!match) return null;
  const all = [...NAV_SECTIONS.flatMap((s) => s.items), ...FOOTER_NAV];
  return all.find((i) => i.href === match)?.mobileTier ?? null;
}
