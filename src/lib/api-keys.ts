/**
 * API key generation and hashing.
 *
 * Keys use the format `sk_live_<64 hex chars>` (72 chars total).
 * We store only the SHA-256 hash — the raw key is shown exactly once
 * at creation time and can never be recovered.
 */

import "server-only";
import { randomBytes, createHash } from "node:crypto";

const PREFIX = "sk_live_";

/**
 * Generate a new API key.
 * Returns the raw key (show once), its SHA-256 hash (store), and a prefix
 * for display in the management UI (e.g. "sk_live_a3b2...").
 */
export function generateApiKey(): {
  rawKey: string;
  keyHash: string;
  keyPrefix: string;
} {
  const secret = randomBytes(32).toString("hex"); // 64 hex chars
  const rawKey = `${PREFIX}${secret}`;
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = rawKey.slice(0, 12); // "sk_live_a3b2"
  return { rawKey, keyHash, keyPrefix };
}

/**
 * One-way SHA-256 hash of a raw API key.
 */
export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

/**
 * Quick format check — does this look like one of our keys?
 */
export function isValidKeyFormat(key: string): boolean {
  return key.startsWith(PREFIX) && key.length === 72;
}
