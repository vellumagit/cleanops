import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // ── Notification-authorization guard ──────────────────────────────────────
  // Notifications and web push must go through the single audience-typed
  // primitive in src/lib/notify.ts, so management-facing content can never be
  // written to a null-recipient row or broadcast to every device (which leaked
  // financials to a cleaner). These rules make the footgun a red CI failure.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/notify.ts", "src/lib/push.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name='insert'][callee.object.callee.property.name='from'][callee.object.arguments.0.value='notifications']",
          message:
            "Do not insert into `notifications` directly — use notify() from @/lib/notify (its explicit `audience` prevents management content leaking to cleaners).",
        },
        {
          selector:
            "CallExpression[callee.property.name='insert'][callee.object.callee.property.name='from'][callee.object.arguments.0.expression.value='notifications']",
          message:
            "Do not insert into `notifications` directly — use notify() from @/lib/notify.",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/push",
              importNames: ["sendPushToOrg"],
              message:
                "sendPushToOrg broadcasts to EVERY device in the org (incl. cleaners). Use notify({ audience: 'org-wide' }) — or sendPushToMembership/sendPushToOrgAdmins for scoped pushes.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
