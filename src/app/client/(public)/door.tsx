import type { ReactNode } from "react";

/**
 * The frame for the pages a client sees before they are in: sign-in, the
 * emailed link's landing, the invite. One job per page and one main button,
 * with type and buttons sized for a phone held in one hand, by someone who
 * may not use a computer much (docs/online-booking-roadmap.md, "Rules for
 * the screens").
 */
export function ClientDoor({ title, lede, children }: { title: string; lede?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-muted/30 px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <h1 className="text-balance text-2xl font-bold tracking-tight">{title}</h1>
        {lede && <p className="mt-2 text-base text-muted-foreground">{lede}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

/** The one main button on a door page. */
export function DoorButton({ children, disabled }: { children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="flex min-h-14 w-full items-center justify-center rounded-xl bg-primary px-5 text-lg font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.99] disabled:opacity-60"
    >
      {children}
    </button>
  );
}

/** A plain coloured note: amber for "something to know", green for "done". */
export function DoorNote({ tone = "amber", children }: { tone?: "amber" | "green"; children: ReactNode }) {
  return (
    <div
      role="status"
      className={
        tone === "green"
          ? "rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-base text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200"
          : "rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-base text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
      }
    >
      {children}
    </div>
  );
}
