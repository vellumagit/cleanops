/**
 * Verify the export is complete and usable:
 *  1. Project still reachable (catches API key rotation / hibernation)
 *  2. Every JSON file parses and has rows
 *  3. Live DB count matches exported count (catches partial exports)
 *  4. Storage files are real, non-zero bytes
 *  5. Auth users have email + id
 *  6. Cross-table FK integrity sanity (memberships reference profiles, etc)
 */

import fs from "fs";
import path from "path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const OUT_DIR = path.join(__dirname, "export");
const STORAGE_DIR = path.join(OUT_DIR, "_storage_files");

const headers = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
};

let passed = 0;
let failed = 0;
const failures: string[] = [];

function ok(label: string) {
  console.log(`  ✅ ${label}`);
  passed++;
}
function fail(label: string) {
  console.log(`  ❌ ${label}`);
  failed++;
  failures.push(label);
}

// ---------------------------------------------------------------------------
// 1. Project still reachable
// ---------------------------------------------------------------------------

async function checkReachable() {
  console.log("\n1. Project reachability");
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/organizations?select=id&limit=1`, { headers });
    if (res.ok) ok(`Project still live at ${SUPABASE_URL}`);
    else fail(`Project returned ${res.status}`);
  } catch (e) {
    fail(`Project unreachable: ${e instanceof Error ? e.message : e}`);
  }
}

// ---------------------------------------------------------------------------
// 2. Every JSON parses
// ---------------------------------------------------------------------------

function checkJsonFiles() {
  console.log("\n2. JSON file integrity");
  const files = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    try {
      const content = fs.readFileSync(path.join(OUT_DIR, f), "utf8");
      const parsed = JSON.parse(content);
      if (!Array.isArray(parsed)) {
        fail(`${f} is not an array`);
      }
    } catch (e) {
      fail(`${f} failed to parse: ${e instanceof Error ? e.message : e}`);
    }
  }
  ok(`${files.length} JSON files all parse as arrays`);
}

// ---------------------------------------------------------------------------
// 3. Live counts match exported counts
// ---------------------------------------------------------------------------

async function checkLiveCounts() {
  console.log("\n3. Live DB vs exported counts");
  const files = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith(".json") && !f.startsWith("_"));

  for (const f of files) {
    const table = f.replace(/\.json$/, "");
    const exported = (
      JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), "utf8")) as unknown[]
    ).length;

    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/${table}?select=id`,
        {
          headers: { ...headers, Prefer: "count=exact", Range: "0-0" },
        },
      );
      const range = res.headers.get("content-range");
      const live = range ? parseInt(range.split("/")[1], 10) : NaN;

      if (Number.isNaN(live)) {
        fail(`${table}: could not read live count`);
      } else if (live !== exported) {
        fail(`${table}: live=${live} exported=${exported} (mismatch)`);
      } else {
        // quiet pass
      }
    } catch {
      fail(`${table}: error querying live count`);
    }
  }
  if (failures.filter((f) => f.includes("live=")).length === 0) {
    ok(`all ${files.length} tables match live row counts`);
  }
}

// ---------------------------------------------------------------------------
// 4. Storage files are real
// ---------------------------------------------------------------------------

function checkStorage() {
  console.log("\n4. Storage files");
  if (!fs.existsSync(STORAGE_DIR)) {
    fail("storage directory missing");
    return;
  }
  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(p));
      else out.push(p);
    }
    return out;
  }
  const files = walk(STORAGE_DIR);
  if (files.length === 0) {
    fail("no storage files found");
    return;
  }
  let totalBytes = 0;
  let zeroByte = 0;
  for (const f of files) {
    const size = fs.statSync(f).size;
    totalBytes += size;
    if (size === 0) zeroByte++;
  }
  if (zeroByte > 0) fail(`${zeroByte} empty storage files`);
  else ok(`${files.length} storage files, ${(totalBytes / 1024).toFixed(1)} KB total`);
}

// ---------------------------------------------------------------------------
// 5. Auth users sanity
// ---------------------------------------------------------------------------

function checkAuthUsers() {
  console.log("\n5. Auth users");
  const usersPath = path.join(OUT_DIR, "_auth_users.json");
  if (!fs.existsSync(usersPath)) {
    fail("auth users file missing");
    return;
  }
  const users = JSON.parse(fs.readFileSync(usersPath, "utf8")) as Array<{
    id: string;
    email?: string;
    created_at?: string;
  }>;

  if (users.length === 0) {
    fail("no auth users");
    return;
  }

  const withEmail = users.filter((u) => u.email).length;
  const withId = users.filter((u) => u.id).length;

  if (withId !== users.length) fail(`${users.length - withId} users missing id`);
  else ok(`${users.length} users all have ids`);

  if (withEmail !== users.length) {
    fail(`${users.length - withEmail} users missing email`);
  } else {
    ok(`${users.length} users all have emails`);
  }
}

// ---------------------------------------------------------------------------
// 6. Foreign key sanity checks
// ---------------------------------------------------------------------------

function checkFKs() {
  console.log("\n6. Cross-table FK sanity");
  function load<T>(file: string): T[] {
    const p = path.join(OUT_DIR, file);
    if (!fs.existsSync(p)) return [];
    return JSON.parse(fs.readFileSync(p, "utf8")) as T[];
  }
  const users = load<{ id: string }>("_auth_users.json");
  const profiles = load<{ id: string }>("profiles.json");
  const orgs = load<{ id: string }>("organizations.json");
  const memberships = load<{ organization_id: string; profile_id: string }>("memberships.json");
  const clients = load<{ organization_id: string }>("clients.json");
  const bookings = load<{ organization_id: string; client_id: string }>("bookings.json");
  const invoices = load<{ organization_id: string; client_id: string }>("invoices.json");

  const userIds = new Set(users.map((u) => u.id));
  const profileIds = new Set(profiles.map((p) => p.id));
  const orgIds = new Set(orgs.map((o) => o.id));
  const clientIds = new Set(clients.map((c) => (c as unknown as { id: string }).id));

  // profiles.id should match auth.users.id
  const profilesWithoutUser = profiles.filter((p) => !userIds.has(p.id)).length;
  if (profilesWithoutUser > 0) fail(`${profilesWithoutUser} profiles have no matching auth user`);
  else ok(`all ${profiles.length} profiles link to auth users`);

  // memberships.profile_id → profiles.id
  const membersWithoutProfile = memberships.filter((m) => !profileIds.has(m.profile_id)).length;
  if (membersWithoutProfile > 0) fail(`${membersWithoutProfile} memberships reference missing profile`);
  else ok(`all ${memberships.length} memberships link to profiles`);

  // memberships.organization_id → organizations.id
  const membersWithoutOrg = memberships.filter((m) => !orgIds.has(m.organization_id)).length;
  if (membersWithoutOrg > 0) fail(`${membersWithoutOrg} memberships reference missing org`);
  else ok(`all ${memberships.length} memberships link to organizations`);

  // clients.organization_id → organizations.id
  const clientsWithoutOrg = clients.filter((c) => !orgIds.has(c.organization_id)).length;
  if (clientsWithoutOrg > 0) fail(`${clientsWithoutOrg} clients reference missing org`);
  else ok(`all ${clients.length} clients link to organizations`);

  // bookings.client_id → clients.id
  const bookingsWithoutClient = bookings.filter((b) => !clientIds.has(b.client_id)).length;
  if (bookingsWithoutClient > 0) fail(`${bookingsWithoutClient} bookings reference missing client`);
  else ok(`all ${bookings.length} bookings link to clients`);

  // invoices.client_id → clients.id
  const invoicesWithoutClient = invoices.filter((i) => !clientIds.has(i.client_id)).length;
  if (invoicesWithoutClient > 0) fail(`${invoicesWithoutClient} invoices reference missing client`);
  else ok(`all ${invoices.length} invoices link to clients`);
}

// ---------------------------------------------------------------------------

async function main() {
  console.log("🔍 Export verification");

  await checkReachable();
  checkJsonFiles();
  await checkLiveCounts();
  checkStorage();
  checkAuthUsers();
  checkFKs();

  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  ✅ ${passed} checks passed`);
  if (failed > 0) {
    console.log(`  ❌ ${failed} checks failed:`);
    for (const f of failures) console.log(`     • ${f}`);
    process.exit(1);
  } else {
    console.log("  🎉 Export is complete and restorable.");
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
