"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowLeft, Sparkles } from "lucide-react";

/**
 * Sticky banner shown when the user navigated into a form from the
 * /app/setup onboarding flow (via ?from=setup). Gives them a visible
 * thread back to setup so they don't get lost mid-task.
 *
 * This renders in the app layout once — it stays hidden on every page
 * unless the URL has ?from=setup, in which case it pins to the top.
 */
export function SetupReturnBanner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Never show on the setup page itself (that's where "back" goes)
  if (pathname === "/app/setup") return null;
  if (searchParams.get("from") !== "setup") return null;

  return (
    <div className="sticky top-14 z-20 border-b border-indigo-500/30 bg-gradient-to-r from-indigo-500/10 to-violet-500/10 px-4 py-2 backdrop-blur lg:top-0">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[13px] text-indigo-900 dark:text-indigo-200">
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            <span className="font-medium">You&rsquo;re setting up your workspace.</span>{" "}
            <span className="hidden text-indigo-700/80 dark:text-indigo-300/80 sm:inline">
              Finish this step and we&rsquo;ll bring you back.
            </span>
          </span>
        </div>
        <Link
          href="/app/setup"
          className="inline-flex shrink-0 items-center gap-1 rounded-md bg-white px-3 py-1 text-xs font-semibold text-indigo-700 shadow-sm transition-colors hover:bg-indigo-50 dark:bg-zinc-900 dark:text-indigo-300 dark:hover:bg-zinc-800"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to setup
        </Link>
      </div>
    </div>
  );
}
