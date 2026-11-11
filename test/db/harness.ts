/**
 * A real Postgres for tests, built from this repo's own migrations.
 *
 * Every other test in the suite uses a fake client or reads source text, and
 * every bug class of autumn 2026 lived exactly where those can't see: a policy
 * that hides a teammate's shift from the caller, an upsert naming an index
 * that doesn't exist (42P10, 2026-11-09), a rule written in SQL and again in
 * TypeScript. This boots PGlite (Postgres compiled to WASM, in-process, no
 * Docker) and applies supabase/migrations in order, so the schema under test
 * is the one the SQL editor would produce from zero.
 *
 * Side effect worth as much as the tests: a migration that does not apply
 * fails here, in CI, before anyone pastes it into production.
 *
 * What is real: tables, constraints, triggers, functions, RLS policies, roles.
 * What is a shim: the things Supabase provides around the schema (the auth
 * and storage schemas, the three API roles and their default grants). There
 * is no PostgREST and no GoTrue, so tests speak SQL; `as(userId)` puts the
 * session in the state PostgREST would for that user's JWT.
 *
 * PGlite tracks current Postgres (18 at the time of writing); production is
 * whatever Supabase runs. Nothing here leans on version-specific behaviour.
 */
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");
const CACHE_DIR = join(ROOT, "node_modules", ".cache", "sollos-test-db");
const EXTENSIONS = { citext, pgcrypto, btree_gist };

/**
 * What a Supabase project has before the first migration runs. Kept as small
 * as the migrations need; when a migration reaches for something that isn't
 * here, add it here rather than editing the migration.
 */
const SUPABASE_SHIM = String.raw`
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin nologin; end if;
  if not exists (select from pg_roles where rolname = 'supabase_storage_admin') then create role supabase_storage_admin nologin; end if;
end $$;

create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;

-- Supabase ships pgcrypto in the extensions schema and puts that schema on
-- every role's search path. Functions here call extensions.gen_random_bytes
-- by that name, so the extension has to live where production keeps it.
create extension if not exists pgcrypto with schema extensions;
do $$ begin
  execute format('alter database %I set search_path to "$user", public, extensions', current_database());
end $$;
set search_path to "$user", public, extensions;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  phone text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  raw_app_meta_data jsonb default '{}'::jsonb,
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Supabase's own definitions: the legacy per-claim setting, else the JSON.
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  )
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.email() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email'
$$;

create table storage.buckets (
  id text primary key,
  name text not null,
  owner uuid,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  owner_id text,
  metadata jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
create function storage.filename(name text) returns text language sql immutable as $$
  select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)]
$$;
create function storage.extension(name text) returns text language sql immutable as $$
  select reverse(split_part(reverse(name), '.', 1))
$$;

create publication supabase_realtime;

-- The grants Supabase gives the API roles on everything in public. With these
-- in place RLS is the gate, exactly as in production; without them a missing
-- policy and a missing grant would look the same from a test.
grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/** Shim, then every migration in filename order. Throws naming the file that failed. */
async function build(): Promise<PGlite> {
  const db = new PGlite({ extensions: EXTENSIONS });
  await db.exec(SUPABASE_SHIM);
  for (const file of migrationFiles()) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`migration ${file} does not apply from zero: ${message}`);
    }
  }
  return db;
}

function fingerprint(): string {
  const h = createHash("sha1");
  h.update(SUPABASE_SHIM);
  for (const file of migrationFiles()) {
    h.update(file);
    h.update(readFileSync(join(MIGRATIONS_DIR, file)));
  }
  return h.digest("hex").slice(0, 16);
}

/**
 * A private database with the full schema and no rows.
 *
 * Building takes about four seconds; reopening a snapshot takes one. The
 * snapshot is keyed on the shim and every migration's bytes, so it can only
 * ever be the schema those files produce. Each test file gets its own
 * instance, and each scenario rolls back, so no test sees another's rows.
 */
export async function openDb(): Promise<PGlite> {
  const snapshot = join(CACHE_DIR, `${fingerprint()}.tgz`);
  if (existsSync(snapshot)) {
    try {
      const db = new PGlite({
        extensions: EXTENSIONS,
        loadDataDir: new Blob([readFileSync(snapshot)]),
      });
      await db.query("select 1");
      return db;
    } catch {
      // A torn or stale snapshot: fall through and rebuild.
    }
  }
  const db = await build();
  try {
    const dump = await db.dumpDataDir("gzip");
    mkdirSync(CACHE_DIR, { recursive: true });
    const tmp = `${snapshot}.${process.pid}.tmp`;
    writeFileSync(tmp, Buffer.from(await dump.arrayBuffer()));
    renameSync(tmp, snapshot); // atomic: another worker sees all of it or none
  } catch {
    // The cache is an optimisation. A read-only checkout still gets its database.
  }
  return db;
}

// ---------------------------------------------------------------------------
// Speaking to it as someone
// ---------------------------------------------------------------------------

export type Sql = <T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
) => Promise<T[]>;

export type World = {
  /** The schema owner, no JWT: for arranging rows. Not how the app connects. */
  seed: Sql;
  /** The service-role key: RLS bypassed. What createSupabaseAdminClient is. */
  service: Sql;
  /** A signed-in user's own client. What createSupabaseServerClient is. */
  as: (userId: string) => Sql;
  /** No session at all: the public key alone. */
  anon: Sql;
};

type Identity = { role: string | null; claims: Record<string, unknown> | null };

function speaker(tx: Transaction, who: Identity): Sql {
  return async <T>(text: string, params: unknown[] = []) => {
    // Each statement sits in its own savepoint so a refusal (RLS, a trigger,
    // a unique index) can be asserted and the scenario can carry on.
    await tx.exec("savepoint statement");
    try {
      await tx.query(
        "select set_config('role', $1, true), set_config('request.jwt.claims', $2, true), set_config('request.jwt.claim.sub', $3, true)",
        [
          who.role ?? "none",
          who.claims ? JSON.stringify(who.claims) : "",
          String(who.claims?.sub ?? ""),
        ],
      );
      const res = await tx.query<T>(text, params);
      await tx.exec("release savepoint statement");
      return res.rows;
    } catch (err) {
      await tx.exec("rollback to savepoint statement");
      throw err;
    }
  };
}

/**
 * Run a scenario inside a transaction that is always rolled back.
 */
export async function scenario(
  db: PGlite,
  run: (w: World) => Promise<void>,
): Promise<void> {
  let failure: unknown;
  await db.transaction(async (tx) => {
    const world: World = {
      seed: speaker(tx, { role: null, claims: null }),
      service: speaker(tx, { role: "service_role", claims: { role: "service_role" } }),
      as: (userId) =>
        speaker(tx, { role: "authenticated", claims: { sub: userId, role: "authenticated" } }),
      anon: speaker(tx, { role: "anon", claims: { role: "anon" } }),
    };
    try {
      await run(world);
    } catch (err) {
      failure = err;
    }
    await tx.rollback();
  });
  if (failure) throw failure;
}

/** The SQLSTATE of a refused statement, or null if it went through. */
export async function refusal(attempt: Promise<unknown>): Promise<string | null> {
  try {
    await attempt;
    return null;
  } catch (err) {
    return (err as { code?: string }).code ?? "unknown";
  }
}

// ---------------------------------------------------------------------------
// Arranging rows
// ---------------------------------------------------------------------------

export type Member = { userId: string; membershipId: string };

let counter = 0;
const next = () => ++counter;

export async function addOrg(sql: Sql, name = "Org"): Promise<string> {
  const n = next();
  const [row] = await sql<{ id: string }>(
    "insert into public.organizations (name, slug) values ($1, $2) returning id",
    [`${name} ${n}`, `org-${n}-${Date.now()}`],
  );
  return row.id;
}

export async function addMember(
  sql: Sql,
  organizationId: string,
  role: "owner" | "admin" | "manager" | "employee",
  name: string = role,
  status: "active" | "invited" | "disabled" = "active",
): Promise<Member> {
  const n = next();
  // The auth trigger makes the profile row, as it does on a real sign-up.
  const [user] = await sql<{ id: string }>(
    "insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id",
    [`user${n}@example.test`, JSON.stringify({ full_name: `${name} ${n}` })],
  );
  const [m] = await sql<{ id: string }>(
    `insert into public.memberships (organization_id, profile_id, role, status)
     values ($1, $2, $3::public.membership_role, $4::public.membership_status) returning id`,
    [organizationId, user.id, role, status],
  );
  return { userId: user.id, membershipId: m.id };
}

export async function addClient(sql: Sql, organizationId: string, name = "Client"): Promise<string> {
  const [row] = await sql<{ id: string }>(
    "insert into public.clients (organization_id, name) values ($1, $2) returning id",
    [organizationId, `${name} ${next()}`],
  );
  return row.id;
}

export async function addBooking(
  sql: Sql,
  organizationId: string,
  clientId: string,
  opts: { scheduledAt?: string; durationMinutes?: number; status?: string } = {},
): Promise<string> {
  const [row] = await sql<{ id: string }>(
    `insert into public.bookings (organization_id, client_id, scheduled_at, duration_minutes, service_type, status)
     values ($1, $2, $3::timestamptz, $4, 'standard', $5::public.booking_status) returning id`,
    [
      organizationId,
      clientId,
      opts.scheduledAt ?? new Date(Date.now() + 86_400_000).toISOString(),
      opts.durationMinutes ?? 120,
      opts.status ?? "confirmed",
    ],
  );
  return row.id;
}

export async function addCrew(
  sql: Sql,
  organizationId: string,
  bookingId: string,
  membershipId: string,
): Promise<void> {
  await sql(
    "insert into public.booking_assignees (organization_id, booking_id, membership_id) values ($1, $2, $3)",
    [organizationId, bookingId, membershipId],
  );
}
