import { defineConfig } from "vitest/config";
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
  },
});
