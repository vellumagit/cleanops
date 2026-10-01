import { cn } from "@/lib/utils";

/**
 * Standard outer shell for any page inside the Sollos 3 ops console.
 * Responsive: tighter padding on mobile, wider on desktop.
 */

type Props = {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

export function PageShell({
  title,
  description,
  actions,
  children,
  className,
}: Props) {
  return (
    <div className={cn("mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 lg:px-8 lg:py-8", className)}>
      <div className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          {description && (
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && (
          // shrink-0 alone let the actions slot claim its full max-content
          // width and refuse to give any back. A booking with no price puts a
          // whole sentence of hint text in here, so on a window under ~900px
          // the title column was starved to nothing: "Standard clean" broke
          // mid-word over the hint and the date wrapped one word per line.
          // Svitlana photographed it on two different bookings.
          //
          // Capped instead, so the heading always keeps its share, and allowed
          // to wrap so a long actions block stacks rather than pushes.
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 sm:max-w-[55%]">
            {actions}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

/**
 * Placeholder for sub-pages that don't exist yet.
 */
export function ComingSoon({ phase }: { phase: string }) {
  return (
    <div className="sollos-card flex flex-col items-center justify-center border-dashed px-6 py-16 text-center">
      <p className="text-sm font-medium text-foreground">Ships in {phase}</p>
      <p className="mt-1 max-w-md text-xs text-muted-foreground">
        This section is part of an upcoming build phase.
      </p>
    </div>
  );
}
