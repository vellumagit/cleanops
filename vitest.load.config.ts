import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * The load and concurrency tests (test/load): the app's own code against a
 * real PostgreSQL server (test/db/real-postgres.ts), where things can happen
 * at the same moment. PGlite, which the ordinary suite uses, takes one query
 * at a time, so no race or lock wait can ever show up there.
 *
 *   node scripts/fetch-postgres.mjs     (once: fetches the server into the project)
 *   pnpm test:load
 *
 * Files run one at a time: each one loads the machine on purpose, and two
 * at once would measure each other.
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
    include: ["test/load/**/*.load.test.ts"],
    env: { SOLLOS_TEST_DB: "postgres" },
    fileParallelism: false,
    // The point of a load test is partly its numbers: print them, and the
    // name of every test, even when everything passes.
    silent: false,
    reporters: ["verbose"],
    testTimeout: 300_000,
    hookTimeout: 300_000,
    retry: 0,
  },
});
