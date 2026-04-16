/**
 * Import everything from scripts/export/ into the NEW Supabase project.
 *
 * Order matters — tables are imported in FK dependency order so every
 * reference already exists by the time it's inserted.
 *
 * Auth users are created with their original UUIDs so profiles.id = auth.users.id.
 * A random temp password is set; users must use "Forgot password" to log in.
 *
 * Idempotent — safe to re-run. Uses upsert on tables with unique keys.
 */

import fs from "fs";
import path from "path";

const SUPABASE_URL = process.env.SUPABASE_URL_NEW!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY_NEW!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL_NEW / SUPABASE_SERVICE_ROLE_KEY_NEW");
  process.exit(1);
}

const OUT_DIR = path.join(__dirname, "export");
const STORAGE_DIR = path.join(OUT_DIR, "_storage_files");

const headers = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};

// ---------------------------------------------------------------------------

function load<T>(file: string): T[] {
  const p = path.join(OUT_DIR, file);
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, "utf8")) as T[];
}

type InsertOpts = {
  /** Upsert on conflict with this column (uses PostgREST resolution=merge-duplicates) */
  onConflict?: string;
  chunk?: number;
};

async function insert(
  table: string,
  rows: unknown[],
  opts: InsertOpts = {},
): Promise<void> {
  if (rows.length === 0) {
    console.log(`  ⏭️  ${table}: 0 rows`);
    return;
  }
  const chunkSize = opts.chunk ?? 200;
  const prefer = opts.onConflict
    ? "resolution=merge-duplicates,return=minimal"
    : "return=minimal";

  let inserted = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i += chunkSize) {
    const batch = rows.slice(i, i + chunkSize);
    const url = opts.onConflict
      ? `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${opts.onConflict}`
      : `${SUPABASE_URL}/rest/v1/${table}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { ...headers, Prefer: prefer },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      // Fall back to one-by-one to find the specific failing row
      for (const row of batch) {
        const r2 = await fetch(url, {
          method: "POST",
          headers: { ...headers, Prefer: prefer },
          body: JSON.stringify([row]),
        });
        if (r2.ok) inserted++;
        else {
          failed++;
          const msg = await r2.text();
          errors.push(`${(row as { id?: string }).id ?? "?"}: ${msg.slice(0, 180)}`);
        }
      }
    } else {
      inserted += batch.length;
    }
  }
  console.log(
    `  ${failed === 0 ? "✅" : "⚠️ "} ${table}: ${inserted}/${rows.length}${failed ? ` (${failed} failed)` : ""}`,
  );
  if (errors.length > 0 && errors.length <= 3) {
    for (const e of errors) console.log(`       ${e}`);
  } else if (errors.length > 3) {
    for (const e of errors.slice(0, 3)) console.log(`       ${e}`);
    console.log(`       ... +${errors.length - 3} more`);
  }
}

// ---------------------------------------------------------------------------
// Create auth users with their original UUIDs — idempotent
// ---------------------------------------------------------------------------

async function restoreAuthUsers(): Promise<void> {
  const users = load<{
    id: string;
    email: string;
    phone?: string;
    user_metadata?: Record<string, unknown>;
    app_metadata?: Record<string, unknown>;
  }>("_auth_users.json");

  console.log(`\n👤 Auth users (${users.length}):`);

  for (const u of users) {
    const tempPassword =
      "Temp_" + Math.random().toString(36).slice(2) + "_" + Date.now().toString(36);

    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: u.id,
        email: u.email,
        phone: u.phone,
        password: tempPassword,
        email_confirm: true,
        phone_confirm: Boolean(u.phone),
        user_metadata: u.user_metadata ?? {},
        app_metadata: u.app_metadata ?? {},
      }),
    });

    if (res.ok) {
      console.log(`  ✅ ${u.email}`);
    } else {
      const body = await res.text();
      if (body.includes("already") || body.includes("duplicate")) {
        console.log(`  ⏭️  ${u.email} already exists`);
      } else {
        console.log(`  ❌ ${u.email}: ${body.slice(0, 200)}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Storage: bucket + files
// ---------------------------------------------------------------------------

async function restoreStorage(): Promise<void> {
  console.log("\n📦 Storage...");

  const buckets = load<{ id: string; name: string; public: boolean }>(
    "_storage_buckets.json",
  );
  for (const b of buckets) {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: b.id, name: b.name, public: b.public }),
    });
    if (res.ok) console.log(`  ✅ bucket: ${b.name}`);
    else {
      const body = await res.text();
      if (body.includes("already exists")) console.log(`  ⏭️  bucket ${b.name}`);
      else console.log(`  ❌ bucket ${b.name}: ${body.slice(0, 200)}`);
    }
  }

  if (!fs.existsSync(STORAGE_DIR)) {
    console.log("  (no storage files)");
    return;
  }

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...walk(p));
      else out.push(p);
    }
    return out;
  }

  const files = walk(STORAGE_DIR);
  let ok = 0;
  let failed = 0;
  for (const localPath of files) {
    const rel = path.relative(STORAGE_DIR, localPath).replaceAll("\\", "/");
    const [bucket, ...parts] = rel.split("/");
    const objectPath = parts.join("/");
    const body = fs.readFileSync(localPath);

    const res = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${bucket}/${objectPath}`,
      {
        method: "POST",
        headers: {
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/octet-stream",
          "x-upsert": "true",
        },
        body,
      },
    );
    if (res.ok) ok++;
    else {
      failed++;
      const msg = await res.text();
      console.log(`  ❌ ${bucket}/${objectPath}: ${msg.slice(0, 150)}`);
    }
  }
  console.log(`  ${ok}/${files.length} files uploaded${failed ? ` (${failed} failed)` : ""}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`🎯 ${SUPABASE_URL}`);

  await restoreAuthUsers();

  console.log("\n📥 Root...");
  await insert("organizations", load("organizations.json"), { onConflict: "id" });
  // profiles are auto-created by a trigger on auth.users insert — upsert to
  // update them with the data we have (full_name, phone, avatar_url, etc).
  await insert("profiles", load("profiles.json"), { onConflict: "id" });
  await insert("memberships", load("memberships.json"), { onConflict: "id" });

  console.log("\n📥 Org-scoped...");
  await insert("clients", load("clients.json"), { onConflict: "id" });
  await insert("packages", load("packages.json"), { onConflict: "id" });
  await insert("bonus_rules", load("bonus_rules.json"), { onConflict: "id" });
  await insert("inventory_items", load("inventory_items.json"), { onConflict: "id" });
  await insert("training_modules", load("training_modules.json"), { onConflict: "id" });
  await insert("freelancer_contacts", load("freelancer_contacts.json"), { onConflict: "id" });
  await insert("invitations", load("invitations.json"), { onConflict: "id" });
  await insert("api_keys", load("api_keys.json"), { onConflict: "id" });
  await insert("webhook_subscriptions", load("webhook_subscriptions.json"), {
    onConflict: "id",
  });
  await insert("integration_connections", load("integration_connections.json"), {
    onConflict: "id",
  });
  await insert("subscriptions", load("subscriptions.json"), { onConflict: "id" });

  console.log("\n📥 Bookings & estimates...");
  await insert("booking_series", load("booking_series.json"), { onConflict: "id" });
  await insert("bookings", load("bookings.json"), { onConflict: "id" });
  await insert("estimates", load("estimates.json"), { onConflict: "id" });
  await insert("estimate_line_items", load("estimate_line_items.json"), { onConflict: "id" });
  await insert("contracts", load("contracts.json"), { onConflict: "id" });

  console.log("\n📥 Booking-dependent...");
  await insert("invoices", load("invoices.json"), { onConflict: "id" });
  await insert("invoice_line_items", load("invoice_line_items.json"), { onConflict: "id" });
  await insert("invoice_payments", load("invoice_payments.json"), { onConflict: "id" });
  await insert("reviews", load("reviews.json"), { onConflict: "id" });
  await insert("time_entries", load("time_entries.json"), { onConflict: "id" });
  await insert("job_offers", load("job_offers.json"), { onConflict: "id" });
  await insert("job_offer_dispatches", load("job_offer_dispatches.json"), { onConflict: "id" });

  console.log("\n📥 Training...");
  await insert("training_steps", load("training_steps.json"), { onConflict: "id" });
  await insert("training_assignments", load("training_assignments.json"), { onConflict: "id" });

  console.log("\n📥 Logs...");
  await insert("inventory_log", load("inventory_log.json"), { onConflict: "id" });
  await insert("bonuses", load("bonuses.json"), { onConflict: "id" });

  console.log("\n📥 Chat...");
  await insert("chat_threads", load("chat_threads.json"), { onConflict: "id" });
  await insert("chat_thread_members", load("chat_thread_members.json"), { onConflict: "id" });
  await insert("chat_messages", load("chat_messages.json"), { onConflict: "id" });

  console.log("\n📥 Social/comms...");
  await insert("notifications", load("notifications.json"), { onConflict: "id" });
  await insert("feed_posts", load("feed_posts.json"), { onConflict: "id" });
  await insert("push_subscriptions", load("push_subscriptions.json"), { onConflict: "id" });

  console.log("\n📥 Audit log...");
  await insert("audit_log", load("audit_log.json"), { onConflict: "id" });

  await restoreStorage();

  console.log("\n🎉 Done.");
  console.log("\nNext: update .env.local + Vercel with new keys, redeploy,");
  console.log("then have users click 'Forgot password' to reset credentials.");
}

main().catch((e) => {
  console.error("\n💥 Fatal:", e);
  process.exit(1);
});
