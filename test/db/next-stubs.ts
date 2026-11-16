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
import { AsyncLocalStorage } from "node:async_hooks";

type Cookie = { name: string; value: string };
type RequestState = { cookies: Cookie[]; after: Array<Promise<unknown>> };

const base: RequestState = { cookies: [], after: [] };
const scoped = new AsyncLocalStorage<RequestState>();
const current = (): RequestState => scoped.getStore() ?? base;

/**
 * The "request" in flight: whose cookies, and the work deferred with after().
 *
 * One shared request by default, which is what a test acting as one person
 * at a time wants. inRequest() gives a block of work its own, so several
 * people can act at the same moment (test/load) without reading each
 * other's cookies.
 */
export const request = {
  get cookies(): Cookie[] {
    return current().cookies;
  },
  set cookies(value: Cookie[]) {
    current().cookies = value;
  },
  get after(): Array<Promise<unknown>> {
    return current().after;
  },
  set after(value: Array<Promise<unknown>>) {
    current().after = value;
  },
};

/** Wait for everything the last action deferred until after its response. */
export async function settle(): Promise<void> {
  await Promise.allSettled(request.after.splice(0));
}

/**
 * Run `work` as a request of its own, signed in with these cookies, and wait
 * for what it deferred with after() before returning.
 */
export async function inRequest<T>(cookies: Cookie[], work: () => Promise<T>): Promise<T> {
  const state: RequestState = { cookies: [...cookies], after: [] };
  return scoped.run(state, async () => {
    try {
      return await work();
    } finally {
      await Promise.allSettled(state.after.splice(0));
    }
  });
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
