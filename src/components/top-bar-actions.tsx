"use client";

import { usePathname } from "next/navigation";
import { Plus, Sparkles } from "lucide-react";

/**
 * Quick actions and the assistant, as two buttons in the phone's top bar.
 *
 * On phones both used to float over the bottom-right corner of every page,
 * stacked above the tab bar — on top of the Export button on Timesheets, the
 * last column of tables, the end of every long form. Brian, 2026-11-14:
 * "really in the way on mobile". The top bar had nothing but the logo and the
 * bell, so they live there now and cover nothing. Desktop keeps the floating
 * buttons (there's room, and Cmd+K).
 *
 * The palette and the assistant panel still belong to their own components;
 * these buttons only ask them to open, through a window event, so neither
 * component has to move into the sidebar's tree.
 */
export const OPEN_QUICK_ACTIONS_EVENT = "sollos:quick-actions";
export const OPEN_ASSISTANT_EVENT = "sollos:assistant";

const btn =
  "flex h-9 w-9 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 active:bg-zinc-800";

export function TopBarActions() {
  const pathname = usePathname();
  // Same rule as the floating versions: chat owns its whole screen.
  if (pathname.startsWith("/app/chat")) return null;
  return (
    <>
      <button
        type="button"
        className={btn}
        aria-label="Quick actions"
        onClick={() => window.dispatchEvent(new Event(OPEN_QUICK_ACTIONS_EVENT))}
      >
        <Plus className="h-[18px] w-[18px]" />
      </button>
      <button
        type="button"
        className={btn}
        aria-label="Open Sollos Assistant"
        onClick={() => window.dispatchEvent(new Event(OPEN_ASSISTANT_EVENT))}
      >
        <Sparkles className="h-4 w-4" />
      </button>
    </>
  );
}
