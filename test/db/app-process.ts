/**
 * `next dev` pointed at the throwaway database, with every real secret
 * blanked. Shared by the local test stack (scripts/dev-test-stack.ts) and the
 * browser tests (test/browser), so the two can never differ in what the app
 * is allowed to reach.
 *
 * Nothing started here can touch production: the Supabase URL and keys are
 * replaced with the in-process API's, and every other variable in the env
 * files (Stripe, Resend, Twilio, Google, Sentry...) is emptied for the child,
 * so a saved booking cannot send a real email or charge a real card.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Api } from "./api";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Keys the app may keep from .env.local: nothing that reaches a real service. */
const KEEP = new Set(["NODE_ENV", "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_SITE_URL"]);

export function blankedSecrets(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of [".env.local", ".env", ".env.development", ".env.development.local"]) {
    const path = join(ROOT, file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
      // Defined wins over the file: Next never overrides a variable the
      // process already has. Empty for secrets; but an on/off flag has to be
      // a valid "off", because src/lib/env.ts rejects an empty string for
      // those and every page that asks for the environment would fail.
      if (!m || KEEP.has(m[1])) continue;
      const key = m[1];
      out[key] = /_(ENABLED|PAUSED|UNPAUSED)$/.test(key) ? "false" : /_ENVIRONMENT$/.test(key) ? "sandbox" : "";
    }
  }
  return out;
}

/**
 * Variables a coding agent's shell carries. `next dev` looks for them and,
 * finding one, rewrites AGENTS.md in the working tree; and the app has no
 * business inheriting an agent session's own settings either way.
 */
const AGENT_SHELL = /^(AI_AGENT|CLAUDE|CLAUDECODE|CURSOR_|CODEX_|COPILOT_|GEMINI_CLI|OPENCODE_CLIENT|REPL_ID|ANTIGRAVITY_AGENT|AUGMENT_AGENT)/;

/** The environment the app runs with: the test API, and nothing real. */
export function appEnv(api: Api): NodeJS.ProcessEnv {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !AGENT_SHELL.test(key)));
  return {
    ...inherited,
    ...blankedSecrets(),
    NEXT_PUBLIC_SUPABASE_URL: api.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: api.anonKey,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: api.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: api.serviceKey,
    SOLLOS_TEST_STACK: "1",
    // `next dev` is development, whoever starts it. Started from the test
    // runner it would inherit NODE_ENV=test: Next then builds into a second
    // folder (.next/dev/dev), takes that for a first run, and rewrites
    // tsconfig.json and AGENTS.md in the working tree.
    NODE_ENV: "development",
  };
}

/** Start `next dev` on this port against the test API. The caller owns the child. */
export function spawnApp(
  api: Api,
  port: number,
  stdio: "inherit" | "pipe" = "inherit",
): ChildProcess {
  const require = createRequire(import.meta.url);
  const nextBin = require.resolve("next/dist/bin/next");
  return spawn(process.execPath, [nextBin, "dev", "-p", String(port)], {
    cwd: ROOT,
    stdio: stdio === "inherit" ? "inherit" : ["ignore", "pipe", "pipe"],
    env: appEnv(api),
  });
}
