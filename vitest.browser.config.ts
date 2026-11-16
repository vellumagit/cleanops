import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * The browser tests (test/browser): the real app in Chrome against the
 * throwaway database. Separate from the unit config because they need one
 * shared stack: every file runs in the same process, one after another, so
 * the database, the app and the browser start once (test/browser/stack.ts).
 *
 *   pnpm test:browser
 */
export default defineConfig({
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./test/stubs/server-only.ts", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["test/browser/**/*.spec.ts"],
    // One process, files in turn, modules shared between them: one stack.
    pool: "forks",
    maxWorkers: 1,
    isolate: false,
    fileParallelism: false,
    // A first visit to a page compiles it; the stack itself takes a while to boot.
    testTimeout: 180_000,
    hookTimeout: 300_000,
    // A flaky browser test is worse than none: no retries, so a real
    // failure is never papered over.
    retry: 0,
  },
});
