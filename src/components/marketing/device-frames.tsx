import { cn } from "@/lib/utils";

/**
 * Frames for the product screenshots on the public site (src/assets/landing).
 * Pure CSS so they cost nothing to load and stay sharp at any size; the
 * pictures inside are real screens of the app, captured from a seeded demo
 * company on a throwaway database (no customer data).
 */

export function BrowserFrame({
  url = "sollos3.com/app",
  className,
  children,
}: {
  url?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_24px_60px_-20px_rgba(24,24,27,0.25),0_2px_6px_rgba(24,24,27,0.06)] ring-1 ring-black/[0.02]",
        className,
      )}
    >
      <div className="flex h-8 items-center gap-3 border-b border-zinc-200 bg-zinc-50 px-3 sm:h-9" aria-hidden>
        <div className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-300" />
        </div>
        <div className="mx-auto hidden h-5 min-w-0 max-w-xs flex-1 items-center justify-center truncate rounded-md border border-zinc-200 bg-white px-3 text-[11px] text-zinc-500 sm:flex">
          {url}
        </div>
        <div className="hidden w-[42px] sm:block" />
      </div>
      {children}
    </div>
  );
}

export function PhoneFrame({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "relative rounded-[2rem] bg-zinc-900 p-[6px] shadow-[0_30px_60px_-20px_rgba(24,24,27,0.45)] ring-1 ring-zinc-900/10 sm:rounded-[2.4rem] sm:p-2",
        className,
      )}
    >
      <div className="relative overflow-hidden rounded-[1.6rem] bg-white sm:rounded-[1.9rem]">
        {children}
      </div>
    </div>
  );
}
