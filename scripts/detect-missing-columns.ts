/**
 * Compare exported JSON rows against the NEW (fresh) project's schema.
 * Any column that exists in the export but not in the new schema gets
 * reported — those are columns that were added manually via SQL editor
 * and never committed as a migration.
 */

import fs from "fs";
import path from "path";

const SUPABASE_URL = process.env.SUPABASE_URL_NEW!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY_NEW!;

const OUT_DIR = path.join(__dirname, "export");
const headers = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
};

async function getLiveColumns(table: string): Promise<Set<string> | null> {
  // Query OpenAPI spec — PostgREST exposes definitions there
  const res = await fetch(`${SUPABASE_URL}/rest/v1/?select=*`, { headers });
  if (!res.ok) return null;
  const spec = (await res.json()) as {
    definitions?: Record<string, { properties?: Record<string, unknown> }>;
  };
  const def = spec.definitions?.[table];
  if (!def?.properties) return null;
  return new Set(Object.keys(def.properties));
}

async function main() {
  const files = fs
    .readdirSync(OUT_DIR)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"));

  for (const f of files) {
    const table = f.replace(/\.json$/, "");
    const rows = JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), "utf8")) as Record<
      string,
      unknown
    >[];
    if (rows.length === 0) continue;

    const exportedCols = new Set(Object.keys(rows[0]));
    const liveCols = await getLiveColumns(table);
    if (!liveCols) {
      console.log(`  ⚠️  ${table}: table not found in new schema`);
      continue;
    }
    const missing = [...exportedCols].filter((c) => !liveCols.has(c));
    if (missing.length > 0) {
      console.log(`❌ ${table}:`);
      for (const c of missing) {
        const sample = rows[0][c];
        const type =
          sample === null
            ? "null"
            : typeof sample === "boolean"
              ? "boolean"
              : typeof sample === "number"
                ? "number"
                : typeof sample === "string"
                  ? /^\d{4}-\d{2}-\d{2}T/.test(sample)
                    ? "timestamptz"
                    : "text"
                  : "jsonb";
        console.log(`    • ${c} (${type}, sample: ${JSON.stringify(sample)?.slice(0, 50)})`);
      }
    }
  }
  console.log("\nDone.");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
