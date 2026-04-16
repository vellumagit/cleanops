/**
 * Supplement the main export:
 *  - Missed tables (freelancer_contacts, integration_events,
 *    job_offer_dispatches, webhook_deliveries)
 *  - auth.identities (OAuth links — so Google/GitHub logins keep working)
 *  - Actual files from storage buckets
 */

import fs from "fs";
import path from "path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const OUT_DIR = path.join(__dirname, "export");
const STORAGE_DIR = path.join(OUT_DIR, "_storage_files");
fs.mkdirSync(STORAGE_DIR, { recursive: true });

const headers = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
};

const EXTRA_TABLES = [
  "freelancer_contacts",
  "integration_events",
  "job_offer_dispatches",
  "webhook_deliveries",
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
      if (res.status === 404 || body.includes("does not exist")) {
        return [];
      }
      console.error(`  ❌ ${table} — ${res.status}`);
      return allRows;
    }
    const rows = (await res.json()) as unknown[];
    allRows.push(...rows);
    if (rows.length < limit) break;
    offset += limit;
  }
  return allRows;
}

type StorageObject = {
  name: string;
  id?: string;
  updated_at?: string;
  created_at?: string;
  last_accessed_at?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Recursively list every object in a bucket (Supabase Storage uses a
 * folder-like path structure, but "list" is per-prefix).
 */
async function listBucketRecursive(
  bucket: string,
  prefix = "",
): Promise<string[]> {
  const url = `${SUPABASE_URL}/storage/v1/object/list/${bucket}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      prefix,
      limit: 1000,
      offset: 0,
      sortBy: { column: "name", order: "asc" },
    }),
  });
  if (!res.ok) {
    console.error(`  ❌ list ${bucket}/${prefix} failed: ${res.status}`);
    return [];
  }
  const items = (await res.json()) as StorageObject[];
  const paths: string[] = [];
  for (const it of items) {
    const full = prefix ? `${prefix}/${it.name}` : it.name;
    // Folders have no id / no metadata.mimetype in Supabase Storage listings
    if (!it.id && !it.metadata) {
      const sub = await listBucketRecursive(bucket, full);
      paths.push(...sub);
    } else {
      paths.push(full);
    }
  }
  return paths;
}

async function downloadFile(bucket: string, objectPath: string): Promise<void> {
  const url = `${SUPABASE_URL}/storage/v1/object/${bucket}/${objectPath}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    console.error(`  ❌ download ${bucket}/${objectPath} — ${res.status}`);
    return;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const localPath = path.join(STORAGE_DIR, bucket, objectPath);
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, buf);
}

async function fetchAuthIdentities(): Promise<unknown[]> {
  // The users endpoint returns each user's identities inline on newer
  // Supabase versions. Re-fetch the full list and extract.
  const allIdentities: unknown[] = [];
  let page = 1;
  const perPage = 1000;
  while (true) {
    const url = `${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=${perPage}`;
    const res = await fetch(url, { headers });
    if (!res.ok) return allIdentities;
    const data = (await res.json()) as {
      users?: Array<{ id: string; identities?: unknown[] }>;
    };
    const users = data.users ?? [];
    for (const u of users) {
      if (Array.isArray(u.identities)) {
        allIdentities.push(...u.identities);
      }
    }
    if (users.length < perPage) break;
    page++;
  }
  return allIdentities;
}

async function main() {
  console.log("🔑", SUPABASE_URL);
  console.log("📁", OUT_DIR);
  console.log("");

  // Missing tables
  console.log("📋 Extra tables...");
  for (const t of EXTRA_TABLES) {
    process.stdout.write(`  ${t}...`);
    const rows = await fetchTable(t);
    if (rows.length > 0) {
      fs.writeFileSync(
        path.join(OUT_DIR, `${t}.json`),
        JSON.stringify(rows, null, 2),
      );
    }
    console.log(` ${rows.length} rows`);
  }

  // Auth identities (OAuth links)
  console.log("📋 auth.identities...");
  const identities = await fetchAuthIdentities();
  fs.writeFileSync(
    path.join(OUT_DIR, "_auth_identities.json"),
    JSON.stringify(identities, null, 2),
  );
  console.log(`  ✅ ${identities.length} identities`);

  // Storage files
  console.log("📋 Storage files...");
  const buckets = JSON.parse(
    fs.readFileSync(path.join(OUT_DIR, "_storage_buckets.json"), "utf8"),
  ) as Array<{ id: string; name: string }>;

  let totalFiles = 0;
  for (const bucket of buckets) {
    process.stdout.write(`  ${bucket.name}...`);
    const paths = await listBucketRecursive(bucket.name);
    for (const p of paths) {
      await downloadFile(bucket.name, p);
    }
    totalFiles += paths.length;
    console.log(` ${paths.length} files`);
  }

  console.log("");
  console.log("✅ Supplement complete.");
  console.log(`   ${totalFiles} storage files saved to ${STORAGE_DIR}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
