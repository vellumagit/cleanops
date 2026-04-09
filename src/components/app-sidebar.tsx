"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Calendar,
  CalendarCheck,
  FileText,
  ScrollText,
  Users,
  UserRound,
  UserPlus,
  Star,
  Award,
  Receipt,
  Package,
  GraduationCap,
  Boxes,
  MessageSquare,
  Settings,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Sollos 3 ops-console sidebar — dark slate surface matching
 * api.velluma.co/dashboard. Grouped sections with uppercase headers so the
 * navigation density stays scannable as the product grows.
 *
 * Colour choices are hard-coded to slate-{900,800,400,200} + indigo-500
 * because the rest of the app runs on a light theme and I don't want the
 * global token swap to also recolour the sidebar.
 */

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

type NavSection = {
  label: string;
  items: NavItem[];
};

const NAV_SECTIONS: NavSection[] = [
  {
    label: "Overview",
    items: [{ href: "/app", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Operations",
    items: [
      { href: "/app/bookings", label: "Bookings", icon: Calendar },
      { href: "/app/scheduling", label: "Scheduling", icon: CalendarCheck },
      { href: "/app/estimates", label: "Estimates", icon: FileText },
      { href: "/app/contracts", label: "Contracts", icon: ScrollText },
      { href: "/app/packages", label: "Packages", icon: Package },
      { href: "/app/inventory", label: "Inventory", icon: Boxes },
    ],
  },
  {
    label: "People",
    items: [
      { href: "/app/clients", label: "Clients", icon: Users },
      { href: "/app/employees", label: "Employees", icon: UserRound },
      { href: "/app/freelancers", label: "Freelancer bench", icon: UserPlus },
      { href: "/app/reviews", label: "Reviews", icon: Star },
      { href: "/app/bonuses", label: "Bonuses", icon: Award },
      { href: "/app/training", label: "Training", icon: GraduationCap },
    ],
  },
  {
    label: "Money",
    items: [{ href: "/app/invoices", label: "Invoices", icon: Receipt }],
  },
  {
    label: "Comms",
    items: [{ href: "/app/chat", label: "Chat", icon: MessageSquare }],
  },
];

const FOOTER_NAV: NavItem[] = [
  { href: "/app/settings", label: "Settings", icon: Settings },
];

type Props = {
  organizationName: string;
  role: string;
  userName: string | null;
};

export function AppSidebar({ organizationName, role, userName }: Props) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/app" ? pathname === "/app" : pathname.startsWith(href);

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-slate-800 bg-slate-900 text-slate-200">
      {/* Brand */}
      <div className="flex items-center gap-2.5 border-b border-slate-800 px-4 py-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/sollos-logo.png"
          alt="Sollos 3"
          className="h-8 w-8 shrink-0 rounded-lg [filter:brightness(0)_invert(1)]"
        />
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-sm font-bold text-white">
            Sollos 3
          </span>
          <span className="truncate text-[11px] text-slate-400">
            {organizationName}
          </span>
        </div>
      </div>

      {/* Sections */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} className="mb-5 last:mb-0">
            <p className="mb-1.5 px-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
              {section.label}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(item.href);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
                        active
                          ? "bg-indigo-500 font-semibold text-white shadow-sm"
                          : "text-slate-400 hover:bg-slate-800 hover:text-slate-100",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-slate-800 px-3 py-3">
        <ul className="mb-2 space-y-0.5">
          {FOOTER_NAV.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
                    active
                      ? "bg-indigo-500 font-semibold text-white shadow-sm"
                      : "text-slate-400 hover:bg-slate-800 hover:text-slate-100",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-950/40 px-2.5 py-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-[11px] font-semibold text-indigo-300">
            {(userName ?? "U").slice(0, 1).toUpperCase()}
          </div>
          <div className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate text-[12px] font-medium text-slate-100">
              {userName ?? "You"}
            </span>
            <span className="truncate text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">
              {role}
            </span>
          </div>
          <form action="/auth/logout" method="post">
            <button
              type="submit"
              className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
              aria-label="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </form>
        </div>

        <p className="mt-2 text-center text-[10px] text-slate-600">
          Sollos 3 · v1.0
        </p>
      </div>
    </aside>
  );
}
