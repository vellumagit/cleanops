/**
 * What stands in for the web framework when a server action runs in a test.
 *
 * A server action needs a request to read cookies from and a render to
 * revalidate. A test has neither. These are the only replacements in the
 * API tests: everything the action itself does (sign-in, membership, every
 * read and write) is the app's own code against the real stack in api.ts.
 *
 *   vi.mock("next/headers", async () => (await import("./next-stubs")).nextHeaders());
 */
type Cookie = { name: string; value: string };

/** The "request" in flight: whose cookies, and the work deferred with after(). */
export const request = {
  cookies: [] as Cookie[],
  after: [] as Array<Promise<unknown>>,
};

/** Wait for everything the last action deferred until after its response. */
export async function settle(): Promise<void> {
  await Promise.allSettled(request.after.splice(0));
}

export const nextHeaders = () => ({
  cookies: async () => ({
    get: (name: string) => request.cookies.find((c) => c.name === name),
    getAll: () => request.cookies,
    has: (name: string) => request.cookies.some((c) => c.name === name),
    set: (name: string, value: string) => {
      request.cookies = [...request.cookies.filter((c) => c.name !== name), { name, value }];
    },
    delete: (name: string) => {
      request.cookies = request.cookies.filter((c) => c.name !== name);
    },
  }),
  headers: async () => new Headers(),
});

export const nextCache = () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: <T,>(fn: T) => fn,
});

export const nextNavigation = () => ({
  // redirect() never returns in Next; throwing keeps that true here.
  redirect: (to: string) => {
    throw new Error(`redirected to ${to}`);
  },
  notFound: () => {
    throw new Error("not found");
  },
  RedirectType: { push: "push", replace: "replace" },
});

export const nextServer = () => ({
  after: (work: (() => unknown) | Promise<unknown>) => {
    request.after.push(Promise.resolve().then(() => (typeof work === "function" ? work() : work)));
  },
});
