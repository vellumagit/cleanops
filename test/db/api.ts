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

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const JWT_SECRET = "sollos-test-jwt-secret-not-a-real-one-0123456789";

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

export type Api = {
  /** The database itself, as its owner. For arranging rows between app calls. */
  db: PGlite;
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
  stop: () => Promise<void>;
};

export async function startApi(): Promise<Api> {
  const binary = postgrestBinary();
  if (!binary) throw new Error("PostgREST binary not found: run `node scripts/fetch-postgrest.mjs`");

  const db = await openDb();
  const [dbPort, restPort, proxyPort] = [await freePort(), await freePort(), await freePort()];

  // One database connection, shared in turn. PostgREST's pool is set to one
  // below, so its requests queue instead of interleaving transactions.
  const socket = new PGLiteSocketServer({ db, port: dbPort, host: "127.0.0.1" });
  await socket.start();

  let output = "";
  const child: ChildProcess = spawn(binary, [], {
    env: {
      ...process.env,
      PGRST_DB_URI: `postgres://postgres:postgres@127.0.0.1:${dbPort}/postgres?sslmode=disable`,
      PGRST_DB_SCHEMAS: "public",
      PGRST_DB_ANON_ROLE: "anon",
      PGRST_JWT_SECRET: JWT_SECRET,
      PGRST_SERVER_HOST: "127.0.0.1",
      PGRST_SERVER_PORT: String(restPort),
      PGRST_DB_POOL: "1",
      // No LISTEN connection, and no server-side prepared statements: both
      // assume more than the one multiplexed connection PGlite has.
      PGRST_DB_CHANNEL_ENABLED: "false",
      PGRST_DB_PREPARED_STATEMENTS: "false",
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
  const inTurn = <T>(work: () => Promise<T>): Promise<T> => {
    inFlight++;
    const run = tail.then(work, work);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run.finally(() => {
      inFlight--;
    });
  };

  const proxy: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      void (async () => {
        const path = req.url ?? "/";
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
        if (!path.startsWith("/rest/v1")) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ message: `test stack has no ${path}` }));
          return;
        }
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) {
          if (v == null || k === "host" || k === "connection" || k === "content-length") continue;
          headers[k] = Array.isArray(v) ? v.join(", ") : v;
        }
        const body = Buffer.concat(chunks);
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
        res.writeHead(answer.status, answer.headers);
        res.end(answer.bytes);
      })().catch((err) => {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ message: `test proxy: ${String(err)}` }));
      });
    });
  });
  await new Promise<void>((resolve) => proxy.listen(proxyPort, "127.0.0.1", resolve));

  const url = `http://127.0.0.1:${proxyPort}`;
  const sql: Sql = <T>(text: string, params: unknown[] = []) =>
    inTurn(async () => (await db.query<T>(text, params)).rows);

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
    db,
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
    stop: async () => {
      // Let work the app fired without waiting for finish, so it meets a
      // database rather than a closed port.
      await drain(5_000);
      proxy.closeAllConnections?.();
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
      child.kill();
      await socket.stop();
      await db.close();
    },
  };
}
