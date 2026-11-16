import { configDefaults, defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Unit-test config. Tests run in a Node environment against pure logic
 * (money math, phone/tax parsing, balance netting, trial math, SMS keyword +
 * signature handling). Two aliases mirror the app:
 *   - "@/..."      → src/... (matches the tsconfig path alias)
 *   - "server-only" → a no-op stub, so importing a lib that guards itself with
 *                     `import "server-only"` doesn't throw under Vitest.
 */
export default defineConfig({
  resolve: {
    alias: {
      "server-only": fileURLToPath(
        new URL("./test/stubs/server-only.ts", import.meta.url),
      ),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // The load tests need a real server and run on their own (pnpm test:load,
    // vitest.load.config.ts).
    exclude: [...configDefaults.exclude, "test/load/**"],
    // The suite now includes tests that read all of src and tests that boot
    // a database (test/db). Run together they slow each other down, and the
    // default five seconds failed tests that were only waiting their turn.
    testTimeout: 20_000,
  },
});
