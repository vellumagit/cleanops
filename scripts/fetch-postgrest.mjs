#!/usr/bin/env node
/**
 * Put PostgREST where the database tests look for it.
 *
 *   node scripts/fetch-postgrest.mjs
 *
 * test/db/*.api.test.ts run the app's own code against a real PostgREST in
 * front of an in-process Postgres (see test/db/api.ts). PostgREST is a
 * program, not an npm package, so it is fetched once from its official
 * GitHub release into node_modules/.cache/postgrest, which git ignores.
 *
 * The version is pinned to production's line (Supabase ran 14.5 on
 * 2026-11-10) and each download is checked against a SHA-256 recorded here,
 * so a changed or tampered file fails instead of running.
 *
 * Windows only: the Windows build needs libpq.dll and friends, which it does
 * not ship. They come from @embedded-postgres/windows-x64 on npm, the
 * packaged official PostgreSQL binaries; only the client DLLs are kept.
 *
 * Safe to run again: it does nothing when the right version is in place.
 */
import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "14.18";
const ASSETS = {
  "win32-x64": {
    file: `postgrest-v${VERSION}-windows-x86-64.zip`,
    sha256: "f24ca175b34d1ec0f3fc6d4c778f279f70577f6b3784b19aaa321e22bc3959b9",
    binary: "postgrest.exe",
  },
  "linux-x64": {
    file: `postgrest-v${VERSION}-linux-static-x86-64.tar.xz`,
    sha256: "98de1c0be7787aea5f5e11a25f303ea0077634d6fc1000b687bfa825fd27d299",
    binary: "postgrest",
  },
};
const WINDOWS_LIBS = {
  pkg: "@embedded-postgres/windows-x64@18.6.0-beta.19",
  dlls: [
    "libpq.dll",
    "libssl-3-x64.dll",
    "libcrypto-3-x64.dll",
    "libintl-9.dll",
    "libiconv-2.dll",
    "libwinpthread-1.dll",
    "zlib1.dll",
    "liblz4.dll",
    "libzstd.dll",
    "libcurl.dll",
  ],
};

const root = fileURLToPath(new URL("..", import.meta.url));
const dest = join(root, "node_modules", ".cache", "postgrest");
const platform = `${process.platform}-${process.arch}`;
const asset = ASSETS[platform];

if (!asset) {
  console.log(
    `[fetch-postgrest] no pinned build for ${platform}. The API tests will skip here; ` +
      `set POSTGREST_BIN to a PostgREST ${VERSION} binary to run them.`,
  );
  process.exit(0);
}

const binary = join(dest, asset.binary);
// Windows ships bsdtar in System32, which reads zip; Git Bash's GNU tar does not.
const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";

const installedVersion = () => {
  try {
    return execFileSync(binary, ["--version"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
};

if (existsSync(binary) && installedVersion()?.includes(VERSION)) {
  console.log(`[fetch-postgrest] PostgREST ${VERSION} already in ${dest}`);
  process.exit(0);
}

mkdirSync(dest, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "postgrest-"));
try {
  const url = `https://github.com/PostgREST/postgrest/releases/download/v${VERSION}/${asset.file}`;
  console.log(`[fetch-postgrest] downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== asset.sha256) {
    throw new Error(`checksum mismatch for ${asset.file}: expected ${asset.sha256}, got ${sha}. Nothing was installed.`);
  }
  const archive = join(work, asset.file);
  writeFileSync(archive, bytes);
  execFileSync(tar, ["-xf", archive, "-C", work], { stdio: "inherit" });
  copyFileSync(join(work, asset.binary), binary);
  if (process.platform !== "win32") execFileSync("chmod", ["+x", binary]);

  if (process.platform === "win32") {
    console.log(`[fetch-postgrest] fetching the PostgreSQL client libraries (${WINDOWS_LIBS.pkg})`);
    // npm verifies the tarball against the registry's integrity hash.
    // npm is a .cmd on Windows, so it goes through the shell; both values are constants above.
    const packed = execSync(`npm pack ${WINDOWS_LIBS.pkg} --silent --pack-destination "${work}"`, {
      encoding: "utf8",
    })
      .trim()
      .split(/\r?\n/)
      .pop();
    execFileSync(tar, ["-xf", join(work, packed), "-C", work], { stdio: "inherit" });
    for (const dll of WINDOWS_LIBS.dlls) {
      copyFileSync(join(work, "package", "native", "bin", dll), join(dest, dll));
    }
  }

  const version = installedVersion();
  if (!version?.includes(VERSION)) throw new Error(`installed binary did not report ${VERSION} (got: ${version})`);
  console.log(`[fetch-postgrest] ready: ${version} in ${dest}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
