#!/usr/bin/env node
/**
 * Put a real PostgreSQL where the load and concurrency tests look for it.
 *
 *   node scripts/fetch-postgres.mjs
 *
 * The everyday database tests run on PGlite: Postgres in WASM, in-process,
 * one query at a time. That is exactly right for "does this migration apply,
 * does this policy hide that row" and exactly wrong for "what happens when
 * thirty cleaners tap at once": nothing can overlap on one connection, so no
 * race, lock wait or pool limit can ever show up. SOLLOS_TEST_DB=postgres
 * (test/db/api.ts) runs the same tests on a real server instead, and the
 * load tests (test/load) need it.
 *
 * The server is the packaged official PostgreSQL from npm
 * (@embedded-postgres/<platform>, the same package fetch-postgrest.mjs
 * already takes the client libraries from). It is fetched once into
 * node_modules/.cache/postgres, which git ignores. Nothing is installed on
 * the machine: no installer, no service, no administrator rights, no
 * Docker, and nothing outside the project folder.
 *
 * The version is pinned, and npm checks the tarball against the registry's
 * integrity hash, so a changed or tampered package fails instead of running.
 *
 * Safe to run again: it does nothing when the right version is in place.
 */
import { execFileSync, execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "18.6.0-beta.19";
const PACKAGES = {
  "win32-x64": { pkg: `@embedded-postgres/windows-x64@${VERSION}`, exe: ".exe" },
  "linux-x64": { pkg: `@embedded-postgres/linux-x64@${VERSION}`, exe: "" },
  "darwin-arm64": { pkg: `@embedded-postgres/darwin-arm64@${VERSION}`, exe: "" },
};

const root = fileURLToPath(new URL("..", import.meta.url));
const dest = join(root, "node_modules", ".cache", "postgres");
const platform = `${process.platform}-${process.arch}`;
const target = PACKAGES[platform];

if (!target) {
  console.log(
    `[fetch-postgres] no pinned build for ${platform}. The load tests will skip here; ` +
      `set POSTGRES_BIN_DIR to the bin folder of a PostgreSQL 18 install to run them.`,
  );
  process.exit(0);
}

const bin = join(dest, "native", "bin");
const postgres = join(bin, `postgres${target.exe}`);
// Windows ships bsdtar in System32; Git Bash's GNU tar does not read everything.
const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";

const installedVersion = () => {
  try {
    return execFileSync(postgres, ["--version"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
};

if (existsSync(postgres) && installedVersion()?.includes("18.")) {
  console.log(`[fetch-postgres] ${installedVersion()} already in ${dest}`);
  process.exit(0);
}

const work = mkdtempSync(join(tmpdir(), "postgres-"));
try {
  console.log(`[fetch-postgres] fetching ${target.pkg}`);
  // npm is a .cmd on Windows, so it goes through the shell; the value is a constant above.
  const packed = execSync(`npm pack ${target.pkg} --silent --pack-destination "${work}"`, { encoding: "utf8" })
    .trim()
    .split(/\r?\n/)
    .pop();
  execFileSync(tar, ["-xf", join(work, packed), "-C", work], { stdio: "inherit" });

  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(join(work, "package", "native"), join(dest, "native"), { recursive: true });

  // Linux and macOS ship some library links as a list, to be made after unpacking.
  const linksFile = join(dest, "native", "pg-symlinks.json");
  if (existsSync(linksFile)) {
    for (const { source, target: link } of JSON.parse(readFileSync(linksFile, "utf8"))) {
      const linkPath = resolve(dest, link);
      try {
        symlinkSync(relative(dirname(linkPath), resolve(dest, source)), linkPath);
      } catch {
        // already there
      }
    }
  }
  if (process.platform !== "win32") {
    for (const name of ["postgres", "initdb", "pg_ctl"]) execFileSync("chmod", ["+x", join(bin, name)]);
  }

  const version = installedVersion();
  if (!version?.includes("18.")) throw new Error(`installed server did not report PostgreSQL 18 (got: ${version})`);
  console.log(`[fetch-postgres] ready: ${version} in ${dest}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
