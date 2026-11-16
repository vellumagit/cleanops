/**
 * A real PostgreSQL server for tests that PGlite cannot be.
 *
 * PGlite is Postgres in WASM with one connection, so a test can never make
 * two things happen at once: no race, no lock wait, no pool running dry.
 * Those are the failures load brings. This starts the packaged official
 * server (scripts/fetch-postgres.mjs puts it in node_modules/.cache/postgres)
 * on a throwaway data directory, builds the same schema the same way
 * (harness.ts: the shim, then every migration), and hands back a pool.
 *
 * It is opt-in. The ordinary suite stays on PGlite, which is faster to start
 * and needs nothing fetched. `SOLLOS_TEST_DB=postgres` makes test/db/api.ts
 * use this instead, and test/load uses it always.
 *
 * Starting is cheap after the first time: the built schema is kept as a
 * cluster folder keyed on the shim and every migration's bytes (the same key
 * as the PGlite snapshot), copied for each run, and cloned per database with
 * CREATE DATABASE ... TEMPLATE.
 *
 * Nothing here can touch anything real: the server listens on 127.0.0.1 on a
 * free port, trusts only that, and its data directory is deleted at the end.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { fingerprint, migrationFiles, MIGRATIONS_DIR, SUPABASE_SHIM, type Sql } from "./harness";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CACHE_DIR = join(ROOT, "node_modules", ".cache", "sollos-test-db");
const EXE = process.platform === "win32" ? ".exe" : "";

// The same shapes PGlite hands back, so a test behaves the same on either:
// bigint as a number (counts), everything else as pg's defaults.
pg.types.setTypeParser(20, (value: string) => Number(value));

export function postgresBinDir(): string | null {
  const candidates = [process.env.POSTGRES_BIN_DIR, join(ROOT, "node_modules", ".cache", "postgres", "native", "bin")];
  return candidates.find((dir): dir is string => !!dir && existsSync(join(dir, `postgres${EXE}`))) ?? null;
}

/** Tests that need a real server skip without it; CI fetches it. */
export const hasRealPostgres = postgresBinDir() !== null;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function bin(name: string): string {
  const dir = postgresBinDir();
  if (!dir) throw new Error("PostgreSQL not found: run `node scripts/fetch-postgres.mjs`");
  return join(dir, `${name}${EXE}`);
}

/** Settings for a server that is thrown away: durability is the one thing a test does not need. */
function serverArgs(dir: string, port: number, maxConnections: number): string[] {
  return [
    "-D", dir,
    "-p", String(port),
    "-c", "listen_addresses=127.0.0.1",
    "-c", "fsync=off",
    "-c", "synchronous_commit=off",
    "-c", "full_page_writes=off",
    "-c", "shared_buffers=128MB",
    "-c", `max_connections=${maxConnections}`,
    "-c", "log_min_messages=warning",
    // Supabase runs in UTC. initdb would otherwise take this machine's zone,
    // and a timestamp read as text would print in it.
    "-c", "timezone=UTC",
    "-c", "log_timezone=UTC",
  ];
}

type Server = { port: number; dir: string; child: ChildProcess; log: () => string };

async function waitReady(port: number, child: ChildProcess, log: () => string): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`postgres exited (${child.exitCode}):\n${log()}`);
    const client = new pg.Client({ host: "127.0.0.1", port, user: "postgres", database: "postgres" });
    try {
      await client.connect();
      await client.end();
      return;
    } catch {
      await client.end().catch(() => {});
    }
    if (Date.now() > deadline) throw new Error(`postgres did not become ready:\n${log()}`);
    await sleep(100);
  }
}

/**
 * Start a server on a free port. A port found free can be taken by another
 * test file starting its own server in the same instant; then try another.
 */
async function startServer(dir: string, maxConnections: number): Promise<Server> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await startServerOnce(dir, maxConnections);
    } catch (err) {
      const busy = err instanceof Error && /could not bind|could not create any TCP\/IP sockets/i.test(err.message);
      if (!busy || attempt >= 5) throw err;
      await sleep(100 * attempt);
    }
  }
}

async function startServerOnce(dir: string, maxConnections: number): Promise<Server> {
  const port = await freePort();
  let output = "";
  const child = spawn(bin("postgres"), serverArgs(dir, port, maxConnections), { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", (d) => (output = (output + d).slice(-20_000)));
  child.stderr?.on("data", (d) => (output = (output + d).slice(-20_000)));
  const server: Server = { port, dir, child, log: () => output };
  // A run that dies before stop() must not leave a server behind.
  process.once("exit", () => {
    if (child.exitCode === null) child.kill();
  });
  await waitReady(port, child, server.log);
  return server;
}

/**
 * Stop and make sure the folder can be removed or reused.
 *
 * Through pg_ctl, which returns once the server is gone. A plain kill works
 * too, but on Windows Node can take fifteen seconds to notice the process
 * has ended, which is longer than a test runner waits for a hook.
 */
async function stopServer(server: Server, clean: boolean): Promise<void> {
  if (server.child.exitCode !== null) return;
  if (!clean) {
    // A throwaway server: tell it to go and don't wait. With many test files
    // stopping at once a wait can outlast the runner's hook timeout, and
    // nothing needs the server gone this instant. Its folder is swept by a
    // later run (sweepStaleDirs).
    try {
      spawn(bin("pg_ctl"), ["stop", "-D", server.dir, "-m", "immediate", "-W"], { stdio: "ignore", detached: true }).unref();
    } catch {
      server.child.kill();
    }
    return;
  }
  try {
    // A clean shutdown, so the folder can be kept as a template.
    execFileSync(bin("pg_ctl"), ["stop", "-D", server.dir, "-m", "fast", "-w", "-t", "60"], { stdio: "ignore" });
  } catch {
    server.child.kill();
  }
}

const DATA_DIR_PREFIX = "sollos-pg-";

/**
 * Remove data folders earlier runs left behind. A folder with a
 * postmaster.pid belongs to a server that is still running (another test
 * run, or a long load test) and is left alone for a day.
 */
function sweepStaleDirs(): void {
  const now = Date.now();
  for (const name of readdirSync(tmpdir())) {
    if (!name.startsWith(DATA_DIR_PREFIX)) continue;
    const dir = join(tmpdir(), name);
    try {
      const age = now - statSync(dir).mtimeMs;
      const running = existsSync(join(dir, "postmaster.pid"));
      if (age > 10 * 60_000 && (!running || age > 24 * 3_600_000)) rmSync(dir, { recursive: true, force: true });
    } catch {
      // In use, or already gone.
    }
  }
}

function removeDir(dir: string): void {
  // Windows holds a folder for a moment after its process ends.
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}

function initCluster(dir: string): void {
  execFileSync(bin("initdb"), ["-D", dir, "-U", "postgres", "-A", "trust", "-E", "UTF8", "--locale=C", "--no-sync"], {
    stdio: "ignore",
  });
}

const TEMPLATE_DB = "sollos_template";

/** The built schema as a stopped cluster folder; built once per schema, then reused. */
async function templateCluster(): Promise<string> {
  const final = join(CACHE_DIR, `pg-cluster-${fingerprint()}`);
  if (existsSync(join(final, "PG_VERSION"))) return final;

  mkdirSync(CACHE_DIR, { recursive: true });
  // One builder at a time: others wait for the folder to appear.
  const lock = `${final}.lock`;
  let building = false;
  try {
    mkdirSync(lock);
    building = true;
  } catch {
    const deadline = Date.now() + 5 * 60_000;
    while (!existsSync(join(final, "PG_VERSION")) && Date.now() < deadline) await sleep(250);
    if (existsSync(join(final, "PG_VERSION"))) return final;
    // The builder died; take over.
    rmSync(lock, { recursive: true, force: true });
    return templateCluster();
  }

  const work = mkdtempSync(join(CACHE_DIR, "pg-build-"));
  try {
    initCluster(work);
    const server = await startServer(work, 20);
    try {
      const admin = new pg.Client({ host: "127.0.0.1", port: server.port, user: "postgres", database: "postgres" });
      await admin.connect();
      await admin.query(`create database ${TEMPLATE_DB}`);
      await admin.end();

      const client = new pg.Client({ host: "127.0.0.1", port: server.port, user: "postgres", database: TEMPLATE_DB });
      await client.connect();
      await client.query(SUPABASE_SHIM);
      for (const file of migrationFiles()) {
        try {
          await client.query(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(`migration ${file} does not apply from zero on a real server: ${message}`);
        }
      }
      await client.end();
    } finally {
      await stopServer(server, true);
    }
    renameSync(work, final); // atomic: another worker sees all of it or none
    return final;
  } catch (err) {
    removeDir(work);
    throw err;
  } finally {
    if (building) rmSync(lock, { recursive: true, force: true });
  }
}

export type RealDatabase = {
  /** The server, for tests that need to talk to it another way. */
  port: number;
  name: string;
  /** A connection string for the database, as its owner. */
  uri: string;
  pool: pg.Pool;
  /** Run SQL as the owner. The same shape as harness.ts's Sql. */
  sql: Sql;
  /** Run a script of several statements. */
  exec: (text: string) => Promise<unknown>;
  /** Another empty-schema database on the same server (a clone of the template). */
  clone: (name: string) => Promise<RealDatabase>;
  /** The server's own log, for a failing test. */
  log: () => string;
  stop: () => Promise<void>;
};

let shared: Promise<{ server: Server; admin: pg.Pool; dataDir: string; refs: number }> | null = null;

function database(
  host: { server: Server; admin: pg.Pool },
  name: string,
  poolMax: number,
  release: () => Promise<void>,
): RealDatabase {
  const pool = new pg.Pool({ host: "127.0.0.1", port: host.server.port, user: "postgres", database: name, max: poolMax });
  // An idle connection killed by a shutdown must not become an unhandled error.
  pool.on("error", () => {});
  const sql: Sql = async <T>(text: string, params: unknown[] = []) =>
    (await pool.query(text, params as unknown[])).rows as T[];
  const self: RealDatabase = {
    port: host.server.port,
    name,
    uri: `postgres://postgres@127.0.0.1:${host.server.port}/${name}`,
    pool,
    sql,
    exec: (text) => pool.query(text),
    clone: async (cloneName) => {
      await createDatabase(host.admin, cloneName);
      return database(host, cloneName, poolMax, async () => {});
    },
    log: host.server.log,
    stop: async () => {
      await pool.end().catch(() => {});
      await release();
    },
  };
  return self;
}

async function createDatabase(admin: pg.Pool, name: string): Promise<void> {
  await admin.query(`create database "${name}" template ${TEMPLATE_DB}`);
  // Per-database settings are not copied with a template.
  await admin.query(`alter database "${name}" set search_path to "$user", public, extensions`);
}

/**
 * A database with the full schema and no rows, on a real server.
 *
 * The server is shared by everything in this process and stops with the last
 * database. `maxConnections` is for the server; `poolMax` for the pool this
 * database hands the test.
 */
export async function startRealDatabase(
  opts: { name?: string; poolMax?: number; maxConnections?: number } = {},
): Promise<RealDatabase> {
  shared ??= (async () => {
    sweepStaleDirs();
    const template = await templateCluster();
    const dataDir = mkdtempSync(join(tmpdir(), DATA_DIR_PREFIX));
    cpSync(template, dataDir, { recursive: true });
    const server = await startServer(dataDir, opts.maxConnections ?? Number(process.env.SOLLOS_TEST_DB_MAX_CONNECTIONS ?? 200));
    const admin = new pg.Pool({ host: "127.0.0.1", port: server.port, user: "postgres", database: "postgres", max: 2 });
    admin.on("error", () => {});
    return { server, admin, dataDir, refs: 0 };
  })();
  const host = await shared;
  host.refs++;
  const name = opts.name ?? `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await createDatabase(host.admin, name);
  return database(host, name, opts.poolMax ?? Number(process.env.SOLLOS_TEST_DB_POOL ?? 20), async () => {
    host.refs--;
    if (host.refs > 0) return;
    shared = null;
    await host.admin.end().catch(() => {});
    await stopServer(host.server, false);
  });
}
