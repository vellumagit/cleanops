import { cn } from "@/lib/utils";

/**
 * Standard outer shell for any page inside the Sollos 3 ops console.
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
    <div className={cn("mx-auto w-full max-w-6xl px-8 py-8", className)}>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          {description && (
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
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
