import { cn } from "@/lib/utils";

/**
 * Standard outer shell for any page inside the ops console. Keeps padding,
 * max-width, and spacing consistent across every section.
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
    <div className={cn("mx-auto w-full max-w-6xl px-8 py-10", className)}>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/**
 * Placeholder for sub-pages that don't exist yet. Displays a friendly
 * "coming soon" empty state so the sidebar never leads to a 404.
 */
export function ComingSoon({ phase }: { phase: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 py-20 text-center">
      <p className="text-sm font-medium text-foreground">Ships in {phase}</p>
      <p className="mt-1 max-w-md text-xs text-muted-foreground">
        This section of the ops console is part of the upcoming build phase.
        Check the phase tracker in the README.
      </p>
    </div>
  );
}
