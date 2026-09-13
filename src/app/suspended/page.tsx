import Link from "next/link";

export const metadata = { title: "Workspace suspended · Sollos 3" };

/**
 * Where a member of a suspended workspace lands. Plain on purpose: a real
 * business that tripped a limit needs one address to write to, and a
 * spammer needs nothing at all.
 */
export default function SuspendedPage() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center gap-4 px-6 py-16 text-center">
      <h1 className="text-2xl font-bold">This workspace is suspended</h1>
      <p className="text-muted-foreground">
        Sign-in, sending and the API are closed for it. If you believe this
        is a mistake, write to{" "}
        <a className="underline underline-offset-2" href="mailto:support@sollos3.com">
          support@sollos3.com
        </a>{" "}
        from the address you signed up with and we&rsquo;ll look the same day.
      </p>
      <p className="text-sm text-muted-foreground">
        <Link href="/login" className="underline underline-offset-2">
          Back to sign in
        </Link>
      </p>
    </main>
  );
}
