/**
 * Rendered by public token pages (/i, /claim, /review, /join) when the
 * caller has exceeded the per-IP rate limit. Does not reveal whether the
 * token is valid — the page looks the same to a scanner whether the link
 * exists or not.
 */

export function RateLimitedPage({ retryAfterSeconds }: { retryAfterSeconds: number }) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-[#fafafa] p-6">
      <div className="max-w-md w-full rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Too many requests
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You&rsquo;ve hit the rate limit. Try again in{" "}
          <strong className="text-foreground">
            {Math.max(1, retryAfterSeconds)} second
            {retryAfterSeconds === 1 ? "" : "s"}
          </strong>
          .
        </p>
      </div>
    </main>
  );
}
