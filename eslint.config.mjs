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
        {
          // Two Svit cleaners clocked in at 3:00 PM Edmonton and the timesheet
          // said 5:00 PM, because a formatter with no timeZone falls back to
          // whatever zone the code happens to run in — America/New_York in the
          // old shared helper, UTC on a Vercel server, the viewer's phone in a
          // client component. All three are wrong, and all three are silent.
          //
          // formatDate/formatDateTime now REQUIRE a tz, so those are compile
          // errors. This covers the raw Intl calls the type system cannot see.
          // Get one from getOrgTimezone(orgId), or thread it in as a prop.
          // toLocaleDateString/toLocaleTimeString are always dates. Plain
          // toLocaleString is not — it is also how numbers get their
          // thousands separators — so it is only flagged when it is visibly
          // called on a Date.
          selector:
            "CallExpression[callee.property.name=/^toLocale(Date|Time)String$/]:not(:has(Property[key.name='timeZone']))",
          message:
            "Pass an explicit `timeZone` — without one this renders in the server's zone (UTC on Vercel) or the viewer's, not the org's. Use getOrgTimezone(). For a DATE column (no time of day) pass \"UTC\" deliberately, so the intent is on the page.",
        },
        {
          selector:
            "CallExpression[callee.property.name='toLocaleString'][callee.object.type='NewExpression'][callee.object.callee.name='Date']:not(:has(Property[key.name='timeZone']))",
          message:
            "Pass an explicit `timeZone` — this formats a Date, so without one it renders in the server's zone (UTC on Vercel) or the viewer's, not the org's.",
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
  {
    /*
     * The timezone tail.
     *
     * Every render the audit confirmed as harmful is fixed — payroll receipts,
     * pay-week boundaries, the schedule email that silently dropped jobs, the
     * public claim page, the client portal, invoices, statements. What is left
     * in these files is the low-harm remainder: form-input defaults, "invited
     * 3 days ago" strings, chat and feed timestamps, document upload dates.
     *
     * They are pinned here rather than silenced, so the rule is a hard error
     * for every other file and for anything written from now on. Clearing an
     * entry is a small, self-contained piece of work; deleting the list when
     * it empties is the point.
     */
    files: [
      "src/app/api/i/*/pdf/route.ts",
      "src/app/app/bookings/*/edit/delete-form.tsx",
      "src/app/app/clients/*/edit/portal-invite-card.tsx",
      "src/app/app/clients/*/portal-invite-button.tsx",
      "src/app/app/contracts/*/edit/signature-panel.tsx",
      "src/app/app/contracts/actions.ts",
      "src/app/app/contracts/contract-documents.tsx",
      "src/app/app/employees/*/documents-panel.tsx",
      "src/app/app/estimates/*/edit/send-form.tsx",
      "src/app/app/invoices/*/auto-send-notice.tsx",
      "src/app/app/invoices/invoice-form.tsx",
      "src/app/app/profile/security/security-panel.tsx",
      "src/app/app/reviews/options.ts",
      "src/app/app/settings/api-keys/api-keys-client.tsx",
      "src/app/app/settings/billing/page.tsx",
      "src/app/app/settings/data/page.tsx",
      "src/app/app/settings/invoicing/invoicing-form.tsx",
      "src/app/app/settings/recurring-invoices/page.tsx",
      "src/app/field/availability/availability-editor.tsx",
      "src/components/chat/chat-view.tsx",
      "src/components/feed/feed-card.tsx",
      "src/lib/automations.ts",
    ],
    rules: { "no-restricted-syntax": "warn" },
  },
]);

export default eslintConfig;
