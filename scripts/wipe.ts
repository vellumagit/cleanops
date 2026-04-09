/**
 * Sollos 3 dev wipe script.
 *
 * Usage:
 *   pnpm wipe            # prompts for confirmation, then wipes all domain data
 *   pnpm wipe --force    # skips confirmation
 *
 * What it does:
 *   - Deletes all rows from every domain table (bookings, clients, freelancer
 *     offers, invoices, chat, audit_log, etc) across ALL organizations.
 *   - Deletes seed-created employee auth users (anything @cleanops-seed.local).
 *   - PRESERVES: organizations, real profiles, real memberships, real auth
 *     users, bonus_rules, and subscriptions. You stay logged in and your org
 *     survives — the next page load shows an empty workspace.
 *
 * Run order matters: children before parents so foreign keys don't block us.
 *
 * Safety:
 *   - Never runs in production unless --allow-prod is passed.
 *   - Uses the service-role client so RLS is bypassed cleanly.
 */

import { createClient } from "@supabase/supabase-js";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { Database } from "../src/lib/supabase/types";

const args = new Set(process.argv.slice(2));
const FORCE = args.has("--force");
const ALLOW_PROD = args.has("--allow-prod");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "❌ Missing env vars. Expected NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
  );
  process.exit(1);
}

if (process.env.NODE_ENV === "production" && !ALLOW_PROD) {
  console.error(
    "❌ Refusing to run in production. Use --allow-prod if you really mean it.",
  );
  process.exit(1);
}

const admin = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * Order matters. Children first, then their parents. We don't touch:
 *   - organizations
 *   - profiles
 *   - memberships
 *   - invitations (keep any pending invites you sent)
 *   - bonus_rules (org config, not data)
 *   - subscriptions (billing state)
 */
const WIPE_ORDER = [
  // Freelancer bench (children → parent)
  "job_offer_dispatches",
  "job_offers",
  "freelancer_contacts",

  // Chat
  "chat_messages",
  "chat_thread_members",
  "chat_threads",

  // Training
  "training_assignments",
  "training_steps",
  "training_modules",

  // Inventory
  "inventory_log",
  "inventory_items",

  // Time / bonuses
  "time_entries",
  "bonuses",

  // Reviews (depend on bookings + memberships)
  "reviews",

  // Money
  "invoice_line_items",
  "invoices",

  // Estimates + contracts
  "estimate_line_items",
  "estimates",
  "contracts",

  // Bookings (depend on clients + packages + memberships)
  "bookings",

  // Catalog
  "packages",

  // Clients
  "clients",

  // Finally, audit log (so we can see the wipe itself has no trace)
  "audit_log",
] as const;

async function confirm(): Promise<boolean> {
  if (FORCE) return true;
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(
    "⚠️  This will DELETE all domain data in ALL organizations. Type 'wipe' to continue: ",
  );
  rl.close();
  return answer.trim().toLowerCase() === "wipe";
}

async function countRows(table: string): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count, error } = await (admin.from as any)(table)
    .select("*", { count: "exact", head: true });
  if (error) return 0;
  return count ?? 0;
}

async function wipeTable(table: string): Promise<number> {
  const before = await countRows(table);
  if (before === 0) {
    console.log(`  · ${table.padEnd(28)} already empty`);
    return 0;
  }
  // Delete everything. Supabase requires a filter on .delete(), so we use a
  // predicate that is true for every UUID row.
  const { error } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from(table as any)
    .delete()
    .not("id", "is", null);
  if (error) {
    console.error(`  ✖ ${table}: ${error.message}`);
    throw error;
  }
  console.log(`  ✓ ${table.padEnd(28)} wiped ${before} row${before === 1 ? "" : "s"}`);
  return before;
}

async function wipeSeedAuthUsers(): Promise<number> {
  // Remove any seed-created employee auth users. Real humans stay.
  let removed = 0;
  let page = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    const users = data.users;
    if (users.length === 0) break;

    for (const u of users) {
      if (u.email?.endsWith("@cleanops-seed.local")) {
        const { error: delErr } = await admin.auth.admin.deleteUser(u.id);
        if (delErr) {
          console.error(`  ✖ could not delete ${u.email}: ${delErr.message}`);
        } else {
          console.log(`  ✓ deleted seed auth user ${u.email}`);
          removed += 1;
        }
      }
    }
    if (users.length < 200) break;
    page += 1;
  }
  return removed;
}

async function main() {
  console.log("Sollos 3 wipe");
  console.log(`Target: ${SUPABASE_URL}`);
  console.log("");

  const ok = await confirm();
  if (!ok) {
    console.log("Aborted.");
    process.exit(0);
  }

  console.log("");
  console.log("Wiping domain tables (children → parents)…");
  let total = 0;
  for (const table of WIPE_ORDER) {
    total += await wipeTable(table);
  }

  console.log("");
  console.log("Removing seed auth users…");
  const removedUsers = await wipeSeedAuthUsers();

  console.log("");
  console.log(`Done. Deleted ${total} domain rows and ${removedUsers} seed auth users.`);
  console.log("");
  console.log("Preserved: organizations, profiles, memberships, invitations,");
  console.log("           bonus_rules, subscriptions, and all real auth users.");
  console.log("");
  console.log("You can reload the app — your workspace is now empty and ready for testing.");
}

main().catch((err) => {
  console.error("❌ Wipe failed:", err);
  process.exit(1);
});
