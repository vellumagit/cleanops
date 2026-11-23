import Link from "next/link";

/**
 * A booking link that leads nowhere: a name nobody has claimed, a page that
 * was taken down, or a draft opened by someone who isn't that company's
 * office. All three look the same on purpose, so the page can't be used to
 * find out which names exist.
 *
 * Whoever lands here was looking for their cleaner, so it says so plainly
 * and offers the one thing that still works: seeing their cleans by email.
 */
export default function BookingPageNotFound() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-muted/30 px-4 py-8">
      <main className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <h1 className="text-balance text-2xl font-bold tracking-tight">We couldn&rsquo;t find that page</h1>
        <p className="mt-2 text-base text-muted-foreground">
          The link may have a typo, or the cleaning company may have changed it. Ask them for their current link.
        </p>
        <p className="mt-4 text-base text-muted-foreground">
          Already a client of a cleaner who uses Sollos? You can still see your visits and invoices.
        </p>
        <Link
          href="/client/login"
          className="mt-6 flex min-h-14 w-full items-center justify-center rounded-xl bg-primary px-5 text-lg font-semibold text-primary-foreground"
        >
          See my cleans
        </Link>
      </main>
    </div>
  );
}
