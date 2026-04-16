/**
 * Export ALL data from the old Supabase project using the service-role key.
 *
 * Usage: npx tsx scripts/export-all-data.ts
 *
 * Outputs JSON files to scripts/export/ — one per table + auth users.
 */

import fs from "fs";
import path from "path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE env vars. Run from project root with .env.local loaded.");
  process.exit(1);
}

const OUT_DIR = path.join(__dirname, "export");
fs.mkdirSync(OUT_DIR, { recursive: true });

const headers = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

// All public schema tables to export
const TABLES = [
  "organizations",
  "profiles",
  "memberships",
  "invitations",
  "clients",
  "packages",
  "bookings",
  "booking_series",
  "estimates",
  "estimate_line_items",
  "contracts",
  "invoices",
  "invoice_line_items",
  "invoice_payments",
  "reviews",
  "training_modules",
  "training_steps",
  "training_assignments",
  "inventory_items",
  "inventory_log",
  "time_entries",
  "bonuses",
  "bonus_rules",
  "chat_threads",
  "chat_thread_members",
  "chat_messages",
  "audit_log",
  "subscriptions",
  "stripe_events",
  "stripe_oauth_states",
  "push_subscriptions",
  "feed_posts",
  "feed_post_reads",
  "automations",
  "automation_log",
  "webhook_subscriptions",
  "api_keys",
  "notifications",
  "payroll_runs",
  "payroll_items",
  "pto_balances",
  "pto_requests",
  "integration_connections",
  "job_offers",
  "job_offer_claims",
  "positions",
];

async function fetchTable(table: string): Promise<unknown[]> {
  const allRows: unknown[] = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=*&offset=${offset}&limit=${limit}`;
    const res = await fetch(url, { headers });

    if (!res.ok) {
      const body = await res.text();
      // Table might not exist — that's fine, some migrations may not have been run
      if (res.status === 404 || body.includes("does not exist")) {
        console.log(`  ⏭️  ${table} — table not found, skipping`);
        return [];
      }
      console.error(`  ❌ ${table} — ${res.status}: ${body.slice(0, 200)}`);
      return allRows;
    }

    const rows = (await res.json()) as unknown[];
    allRows.push(...rows);

    if (rows.length < limit) break; // last page
    offset += limit;
  }

  return allRows;
}

async function fetchAuthUsers(): Promise<unknown[]> {
  // Supabase Auth admin API — list all users
  const allUsers: unknown[] = [];
  let page = 1;
  const perPage = 1000;

  while (true) {
    const url = `${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=${perPage}`;
    const res = await fetch(url, { headers });

    if (!res.ok) {
      const body = await res.text();
      console.error(`  ❌ auth.users — ${res.status}: ${body.slice(0, 200)}`);
      return allUsers;
    }

    const data = (await res.json()) as { users?: unknown[] };
    const users = data.users ?? [];
    allUsers.push(...users);

    if (users.length < perPage) break;
    page++;
  }

  return allUsers;
}

async function fetchStorageBuckets(): Promise<unknown[]> {
  const url = `${SUPABASE_URL}/storage/v1/bucket`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    console.log("  ⏭️  storage buckets — not accessible or empty");
    return [];
  }
  return (await res.json()) as unknown[];
}

async function main() {
  console.log("🔑 Exporting from:", SUPABASE_URL);
  console.log("📁 Output dir:", OUT_DIR);
  console.log("");

  // Export auth users
  console.log("📋 Exporting auth.users...");
  const users = await fetchAuthUsers();
  fs.writeFileSync(
    path.join(OUT_DIR, "_auth_users.json"),
    JSON.stringify(users, null, 2),
  );
  console.log(`  ✅ auth.users — ${users.length} users`);

  // Export storage buckets
  console.log("📋 Exporting storage buckets...");
  const buckets = await fetchStorageBuckets();
  fs.writeFileSync(
    path.join(OUT_DIR, "_storage_buckets.json"),
    JSON.stringify(buckets, null, 2),
  );
  console.log(`  ✅ storage buckets — ${buckets.length} buckets`);

  // Export all public tables
  let totalRows = 0;
  for (const table of TABLES) {
    process.stdout.write(`📋 Exporting ${table}...`);
    const rows = await fetchTable(table);
    if (rows.length > 0) {
      fs.writeFileSync(
        path.join(OUT_DIR, `${table}.json`),
        JSON.stringify(rows, null, 2),
      );
    }
    totalRows += rows.length;
    console.log(` ${rows.length} rows`);
  }

  console.log("");
  console.log(`✅ Export complete. ${totalRows} total rows across ${TABLES.length} tables.`);
  console.log(`✅ ${users.length} auth users exported.`);
  console.log(`📁 Files saved to: ${OUT_DIR}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
