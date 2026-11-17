/**
 * The app's own code, against a real database behind a real PostgREST.
 *
 * harness.ts gives tests a Postgres to speak SQL to. That proves what the
 * database does; it cannot run a server action, because the app talks to
 * Supabase through PostgREST: every embed, filter and upsert is PostgREST's
 * to interpret. This starts the pieces in between:
 *
 *   PGlite  <- pglite-socket (TCP) <-  PostgREST  <- a tiny proxy <-  supabase-js
 *
 * PostgREST is the same program Supabase runs (14.x in production), so an
 * embed that is ambiguous there is ambiguous here. The proxy only does what
 * the Supabase gateway does around it: strips the /rest/v1 prefix, and
 * answers /auth/v1/user from the caller's own token (there is no GoTrue).
 *
 * useAsSupabase() points the environment at it, after which the REAL
 * createSupabaseAdminClient (guardQueries and all) talks to this stack
 * with no mocks in the app's data path.
 *
 * The binary is not in the repo. `node scripts/fetch-postgrest.mjs` puts it
 * in node_modules/.cache/postgrest; CI does the same. Without it these tests
 * skip locally and fail in CI.
 *
 * SOLLOS_TEST_DB=postgres swaps PGlite for a real PostgreSQL server
 * (real-postgres.ts; `node scripts/fetch-postgres.mjs` fetches it). Then
 * PostgREST gets a real pool, requests are no longer taken in turn, and two
 * things can genuinely happen at once: what the load tests are for.
 */
import type { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { spawn, type ChildProcess } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, type Sql } from "./harness";
import { hasRealPostgres, startRealDatabase, type RealDatabase } from "./real-postgres";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const JWT_SECRET = "sollos-test-jwt-secret-not-a-real-one-0123456789";
/** A little under where production starts refusing (see the proxy). About 320 ids in one `in.(...)`. */
export const MAX_URL_BYTES = 12_000;

export function postgrestBinary(): string | null {
  const candidates = [
    process.env.POSTGREST_BIN,
    join(ROOT, "node_modules", ".cache", "postgrest", process.platform === "win32" ? "postgrest.exe" : "postgrest"),
  ];
  return candidates.find((p): p is string => !!p && existsSync(p)) ?? null;
}

/** Tests that need the API skip without the binary; CI treats that as a failure. */
export const hasPostgrest = postgrestBinary() !== null;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** A token PostgREST accepts: the same shape as a Supabase key or session. */
export function signToken(claims: Record<string, unknown>): string {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ iat: now, exp: now + 3600, ...claims })}`;
  return `${body}.${createHmac("sha256", JWT_SECRET).update(body).digest("base64url")}`;
}

/** One database call the app made through the stack. */
export type Traffic = {
  method: string;
  /** Table or function, e.g. "bookings" or "rpc/syncJob". */
  path: string;
  query: string;
  status: number;
  ms: number;
  /** Rows in the answer, from Content-Range (null when not reported). */
  rows: number | null;
  /** Exactly 1,000 rows with no limit or range of its own: the API's cap, probably cut short. */
  capped: boolean;
};

export type Api = {
  /** What is underneath: PGlite (one connection, the default) or a real server. */
  kind: "pglite" | "postgres";
  /** The database itself, as its owner: for a script of several statements. */
  db: Pick<PGlite, "exec">;
  /** The real server and its pool, when kind is "postgres". */
  real: RealDatabase | null;
  sql: Sql;
  /** What NEXT_PUBLIC_SUPABASE_URL would be. */
  url: string;
  serviceKey: string;
  anonKey: string;
  /** A signed-in user's access token. */
  tokenFor: (userId: string, email?: string) => string;
  /**
   * The cookie a browser would carry for that user, in the form @supabase/ssr
   * stores a session. Hand these to a stubbed next/headers and the app's own
   * createSupabaseServerClient signs in as her, with nothing else replaced.
   */
  sessionCookies: (userId: string, email?: string) => Array<{ name: string; value: string }>;
  /** Point the process at this stack. Returns the undo. */
  useAsSupabase: () => () => void;
  /** PostgREST's own log, for a failing test. */
  log: () => string;
  /** Record every database call the app makes between start() and stop(). */
  traffic: { start: () => void; stop: () => Traffic[] };
  /**
   * Files the app put in storage, "bucket/path" to byte size. The stand-in
   * keeps files and answers uploads, removals and signed links; it does not
   * enforce storage policies, so a test here proves what the app asked for,
   * not what storage would have allowed.
   */
  storage: Map<string, number>;
  stop: () => Promise<void>;
};

export async function startApi(): Promise<Api> {
  const binary = postgrestBinary();
  if (!binary) throw new Error("PostgREST binary not found: run `node scripts/fetch-postgrest.mjs`");

  const usePostgres = process.env.SOLLOS_TEST_DB === "postgres";
  if (usePostgres && !hasRealPostgres) {
    throw new Error("SOLLOS_TEST_DB=postgres, but PostgreSQL is not fetched: run `node scripts/fetch-postgres.mjs`");
  }
  const real = usePostgres ? await startRealDatabase() : null;
  const db = real ? null : await openDb();
  // freePort finds a port and lets it go; with eight files starting at once,
  // another can take it before this one listens (EADDRINUSE, 2026-11-16: a
  // file hung four minutes in setup). The proxy listens on port 0 instead
  // (below), and the database socket tries again on a new port.
  const restPort = await freePort();

  let socket: PGLiteSocketServer | null = null;
  let dbUri: string;
  if (real) {
    dbUri = `${real.uri}?sslmode=disable`;
  } else {
    // One database connection, shared in turn. PostgREST's pool is set to one
    // below, so its requests queue instead of interleaving transactions.
    let dbPort = 0;
    for (let attempt = 1; ; attempt++) {
      dbPort = await freePort();
      socket = new PGLiteSocketServer({ db: db!, port: dbPort, host: "127.0.0.1" });
      try {
        await socket.start();
        break;
      } catch (err) {
        if (attempt >= 5 || !/EADDRINUSE/.test(String(err))) throw err;
      }
    }
    dbUri = `postgres://postgres:postgres@127.0.0.1:${dbPort}/postgres?sslmode=disable`;
  }

  let output = "";
  const child: ChildProcess = spawn(binary, [], {
    env: {
      ...process.env,
      PGRST_DB_URI: dbUri,
      PGRST_DB_SCHEMAS: "public",
      PGRST_DB_ANON_ROLE: "anon",
      PGRST_JWT_SECRET: JWT_SECRET,
      PGRST_SERVER_HOST: "127.0.0.1",
      PGRST_SERVER_PORT: String(restPort),
      // On PGlite: one connection, no LISTEN connection and no server-side
      // prepared statements, which all assume more than the one multiplexed
      // connection it has. On a real server: a real pool, as in production.
      PGRST_DB_POOL: real ? String(process.env.SOLLOS_TEST_REST_POOL ?? 10) : "1",
      PGRST_DB_CHANNEL_ENABLED: "false",
      PGRST_DB_PREPARED_STATEMENTS: real ? "true" : "false",
      // Production's cap, so a read that would be cut short there is cut
      // short here too (checked 2026-11-15: audit_log had 1,756 rows and one
      // read returned 1,000). Without it every unbounded read looked whole.
      PGRST_DB_MAX_ROWS: "1000",
      PGRST_LOG_LEVEL: "warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => (output += d));
  child.stderr?.on("data", (d) => (output += d));
  // A test run that dies before stop() must not leave the server behind.
  const reap = () => {
    if (child.exitCode === null) child.kill();
  };
  process.once("exit", reap);

  const rest = `http://127.0.0.1:${restPort}`;
  const serviceKey = signToken({ role: "service_role" });
  const anonKey = signToken({ role: "anon" });

  // Ready when a real query answers: the schema cache loads a moment after
  // the port opens, and until then every request is a 503.
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`PostgREST exited (${child.exitCode}):\n${output}`);
    try {
      const res = await fetch(`${rest}/organizations?select=id&limit=1`, {
        headers: { Authorization: `Bearer ${serviceKey}` },
      });
      if (res.ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`PostgREST did not become ready:\n${output}`);
    await new Promise((r) => setTimeout(r, 100));
  }

  // PGlite has ONE connection. PostgREST runs each request as a transaction
  // on it over the socket, and a test arranging rows talks to it directly.
  // If the two overlap, the direct statement lands inside PostgREST's open
  // transaction: an UPDATE inside its read-only GET, or an error that aborts
  // a request the app is still waiting on. The app also fires work it does
  // not wait for (calendar pushes, notifications), so "the action returned"
  // does not mean "nothing is in flight". Everything therefore takes turns:
  // each proxied request holds the lock until PostgREST has answered, and
  // each direct query holds it too.
  let tail: Promise<unknown> = Promise.resolve();
  let inFlight = 0;
  // On a real server nothing takes turns: requests overlap as they would in
  // production. They are still counted, so stop() can wait for them.
  const inTurn = <T>(work: () => Promise<T>): Promise<T> => {
    inFlight++;
    let run: Promise<T>;
    if (real) {
      run = work();
    } else {
      run = tail.then(work, work);
      tail = run.then(
        () => undefined,
        () => undefined,
      );
    }
    return run.finally(() => {
      inFlight--;
    });
  };

  let recording: Traffic[] | null = null;
  const stored = new Map<string, number>();

  const proxy: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      void (async () => {
        const path = req.url ?? "/";
        // A browser may call this stack too (scripts/dev-test-stack.ts runs
        // the app against it), from another origin. Tests don't care.
        res.setHeader("access-control-allow-origin", req.headers.origin ?? "*");
        res.setHeader("access-control-allow-credentials", "true");
        res.setHeader("access-control-allow-headers", req.headers["access-control-request-headers"] ?? "*");
        res.setHeader("access-control-allow-methods", "GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS");
        res.setHeader("access-control-expose-headers", "content-range,preference-applied,location");
        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }
        if (path.startsWith("/auth/v1/user")) {
          const token = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
          const [head, payload, signature] = token.split(".");
          let claims: Record<string, unknown> | null = null;
          // Like GoTrue, only a token this stack signed names a user.
          const expected = createHmac("sha256", JWT_SECRET).update(`${head}.${payload}`).digest("base64url");
          if (signature === expected) {
            try {
              claims = JSON.parse(Buffer.from(payload ?? "", "base64url").toString("utf8"));
            } catch {
              claims = null;
            }
          }
          if (!claims?.sub) {
            res.writeHead(401, { "content-type": "application/json" });
            res.end(JSON.stringify({ code: 401, msg: "invalid token" }));
            return;
          }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              id: claims.sub,
              aud: "authenticated",
              role: "authenticated",
              email: claims.email ?? null,
              app_metadata: {},
              user_metadata: {},
              created_at: new Date(0).toISOString(),
            }),
          );
          return;
        }
        // Storage, as far as the app uses it: upload, remove, signed link.
        if (path.startsWith("/storage/v1/object/")) {
          const rest = decodeURIComponent(path.split("?")[0].slice("/storage/v1/object/".length));
          const reply = (status: number, body: unknown) => {
            res.writeHead(status, { "content-type": "application/json" });
            res.end(JSON.stringify(body));
          };
          if (!req.headers.authorization) return reply(401, { error: "no key" });
          if (req.method === "POST" && rest.startsWith("sign/")) {
            const key = rest.slice("sign/".length);
            if (!stored.has(key)) return reply(404, { statusCode: "404", error: "not_found", message: "Object not found" });
            return reply(200, { signedURL: `/object/sign/${key}?token=test` });
          }
          if (req.method === "POST" || req.method === "PUT") {
            const body = Buffer.concat(chunks);
            if (req.method === "POST" && stored.has(rest)) {
              return reply(409, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
            }
            stored.set(rest, body.length);
            return reply(200, { Key: rest, Id: rest });
          }
          if (req.method === "DELETE") {
            const bucket = rest.split("/")[0];
            let prefixes: string[] = [];
            try {
              prefixes = (JSON.parse(Buffer.concat(chunks).toString("utf8")) as { prefixes?: string[] }).prefixes ?? [];
            } catch {
              prefixes = [];
            }
            const removed = prefixes.filter((p) => stored.delete(`${bucket}/${p}`)).map((name) => ({ name, bucket_id: bucket }));
            return reply(200, removed);
          }
          return reply(405, { error: `stand-in storage has no ${req.method}` });
        }
        // GoTrue's admin lookup, which the app uses to find an owner's email
        // (getOrgAdminRecipients): only with the service key, like GoTrue.
        const adminUser = /^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/.exec(path.split("?")[0]);
        if (adminUser && req.method === "GET") {
          const key = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
          if (key !== serviceKey) {
            res.writeHead(401, { "content-type": "application/json" });
            res.end(JSON.stringify({ code: 401, msg: "service key required" }));
            return;
          }
          const [user] = await sql<{ id: string; email: string | null; meta: Record<string, unknown> | null }>(
            "select id, email, raw_user_meta_data as meta from auth.users where id = $1",
            [adminUser[1]],
          );
          if (!user) {
            res.writeHead(404, { "content-type": "application/json" });
            res.end(JSON.stringify({ code: 404, msg: "User not found" }));
            return;
          }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ id: user.id, email: user.email, user_metadata: user.meta ?? {}, app_metadata: {} }));
          return;
        }
        if (!path.startsWith("/rest/v1")) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ message: `test stack has no ${path}` }));
          return;
        }
        // Production refuses a request whose address is too long: measured
        // 2026-11-16, 375 ids in an `in.(...)` (13,950 bytes) went through and
        // 400 (14,875) failed. The app learns that only from production, so
        // the stack refuses earlier, at MAX_URL_BYTES, and every test meets it:
        // an id list that grows with a company's history fails here first.
        if (path.length > MAX_URL_BYTES) {
          res.writeHead(414, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              code: "414",
              message: `test stack: request address is ${path.length} bytes, over ${MAX_URL_BYTES}; production refuses these (send the ids in chunks, or filter by a join)`,
              details: null,
              hint: null,
            }),
          );
          return;
        }
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) {
          if (v == null || k === "host" || k === "connection" || k === "content-length") continue;
          headers[k] = Array.isArray(v) ? v.join(", ") : v;
        }
        const body = Buffer.concat(chunks);
        const started = performance.now();
        const answer = await inTurn(async () => {
          const upstream = await fetch(`${rest}${path.slice("/rest/v1".length) || "/"}`, {
            method: req.method,
            headers,
            body: body.length > 0 ? body : undefined,
          });
          const out: Record<string, string> = {};
          upstream.headers.forEach((v, k) => {
            if (k !== "transfer-encoding" && k !== "content-encoding" && k !== "content-length" && k !== "connection") {
              out[k] = v;
            }
          });
          // Read to the end inside the turn: the transaction is over only
          // when PostgREST has sent the whole response.
          return { status: upstream.status, headers: out, bytes: Buffer.from(await upstream.arrayBuffer()) };
        });
        if (recording) {
          const rest = path.slice("/rest/v1/".length);
          const [table, query = ""] = rest.split("?");
          const range = answer.headers["content-range"] ?? "";
          const m = /^(\d+)-(\d+)\//.exec(range);
          // A HEAD (a count with head: true) returns no rows, whatever range
          // the header names.
          const rows = req.method === "HEAD" ? 0 : m ? Number(m[2]) - Number(m[1]) + 1 : /^\*\//.test(range) ? 0 : null;
          // A read that asked for at most 1,000 rows and got 1,000 is whole.
          // One that asked for more (.range(0, 4999)) is cut all the same:
          // the server's cap wins over what the code asked for.
          const limit = Number(/(?:^|&)limit=(\d+)/.exec(query)?.[1] ?? NaN);
          const askedForRange = (Number.isFinite(limit) && limit <= 1000) || Boolean(req.headers.range);
          recording.push({
            method: req.method ?? "GET",
            path: table,
            query: decodeURIComponent(query).slice(0, 4000),
            status: answer.status,
            ms: Math.round(performance.now() - started),
            rows,
            capped: rows === 1000 && !askedForRange,
          });
        }
        res.writeHead(answer.status, answer.headers);
        res.end(answer.bytes);
      })().catch((err) => {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ message: `test proxy: ${String(err)}` }));
      });
    });
  });
  // Port 0: the system picks a free one, so two files never collide here.
  await new Promise<void>((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(0, "127.0.0.1", () => resolve());
  });
  const proxyAddress = proxy.address();
  const proxyPort = typeof proxyAddress === "object" && proxyAddress ? proxyAddress.port : 0;

  const url = `http://127.0.0.1:${proxyPort}`;
  // One thing takes turns badly: PostgREST reloading its schema after its
  // connection dropped. That reload is its own, not a proxied request, so it
  // holds no turn, and a direct statement can land inside its read-only
  // transaction under a busy full run ("cannot execute INSERT in a read-only
  // transaction", 2026-11-16, a file that passed alone). Postgres refused the
  // statement before running it, so it is safe to try again once the reload
  // has finished.
  const sql: Sql = <T>(text: string, params: unknown[] = []) =>
    inTurn(async () => {
      if (real) return await real.sql<T>(text, params);
      for (let attempt = 1; ; attempt++) {
        try {
          return (await db!.query<T>(text, params)).rows;
        } catch (err) {
          if (attempt >= 5 || !/read-only transaction/.test(err instanceof Error ? err.message : String(err))) throw err;
          await new Promise((r) => setTimeout(r, 200 * attempt));
        }
      }
    });

  /** Resolves once nothing has been in flight for a moment, or after `maxMs`. */
  const drain = async (maxMs: number) => {
    const deadline = Date.now() + maxMs;
    let quietSince = Date.now();
    while (Date.now() < deadline) {
      if (inFlight > 0) quietSince = Date.now();
      else if (Date.now() - quietSince >= 150) return;
      await new Promise((r) => setTimeout(r, 25));
    }
  };

  return {
    kind: real ? "postgres" : "pglite",
    db: real ? { exec: real.exec as PGlite["exec"] } : db!,
    real,
    sql,
    url,
    serviceKey,
    anonKey,
    tokenFor: (userId, email) => signToken({ role: "authenticated", sub: userId, ...(email ? { email } : {}) }),
    sessionCookies: (userId, email) => {
      const access_token = signToken({ role: "authenticated", sub: userId, ...(email ? { email } : {}) });
      const now = Math.floor(Date.now() / 1000);
      const session = {
        access_token,
        token_type: "bearer",
        expires_in: 3600,
        expires_at: now + 3600,
        refresh_token: "test-refresh-token",
        user: {
          id: userId,
          aud: "authenticated",
          role: "authenticated",
          email: email ?? null,
          app_metadata: {},
          user_metadata: {},
          created_at: new Date(0).toISOString(),
        },
      };
      // supabase-js names the cookie after the first label of the API host.
      const name = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
      return [{ name, value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}` }];
    },
    useAsSupabase: () => {
      const before = {
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      };
      process.env.NEXT_PUBLIC_SUPABASE_URL = url;
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = anonKey;
      process.env.SUPABASE_SERVICE_ROLE_KEY = serviceKey;
      return () => {
        for (const [k, v] of Object.entries(before)) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
      };
    },
    log: () => output,
    traffic: {
      start: () => {
        recording = [];
      },
      stop: () => {
        const out = recording ?? [];
        recording = null;
        return out;
      },
    },
    storage: stored,
    stop: async () => {
      // Let work the app fired without waiting for finish, so it meets a
      // database rather than a closed port.
      await drain(5_000);
      proxy.closeAllConnections?.();
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
      child.kill();
      await socket?.stop();
      await db?.close();
      await real?.stop();
    },
  };
}
