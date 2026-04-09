/**
 * AES-256-GCM symmetric encryption for secrets-at-rest.
 *
 * Used to encrypt OAuth access + refresh tokens for Stripe, Square, and
 * QuickBooks before they are stored in `integration_connections`. The
 * threat model is: a leaked Postgres backup / misconfigured RLS / a
 * compromised service-role key alone should not be enough to act on a
 * user's payment processor account.
 *
 * The encryption key lives in `INTEGRATION_ENCRYPTION_KEY`, which must
 * be a base64-encoded 32-byte random value. Generate one with:
 *
 *     node -e "console.log('base64:' + require('crypto').randomBytes(32).toString('base64'))"
 *
 * Ciphertext wire format (all joined with ':'):
 *
 *     v1:<iv b64>:<auth tag b64>:<ciphertext b64>
 *
 * The `v1:` prefix lets us rotate algorithms later without a data
 * migration — a future `v2:` branch could decode a different cipher.
 */

import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // GCM standard

let cachedKey: Buffer | null = null;

/**
 * Load the encryption key from env. Throws loudly if missing or malformed
 * so misconfiguration fails fast at the first encrypt/decrypt call rather
 * than silently producing broken ciphertext.
 */
function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "INTEGRATION_ENCRYPTION_KEY is not set. Generate with: " +
        "node -e \"console.log('base64:' + require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }

  // Accept both "base64:..." and bare base64 for flexibility.
  const b64 = raw.startsWith("base64:") ? raw.slice("base64:".length) : raw;
  let key: Buffer;
  try {
    key = Buffer.from(b64, "base64");
  } catch {
    throw new Error("INTEGRATION_ENCRYPTION_KEY is not valid base64");
  }
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `INTEGRATION_ENCRYPTION_KEY must decode to ${KEY_LENGTH} bytes, got ${key.length}`,
    );
  }
  cachedKey = key;
  return key;
}

/**
 * Encrypt a plaintext secret. Returns `null` for null/empty input so
 * callers can do `encrypt(maybeToken)` without branching.
 */
export function encryptSecret(plaintext: string | null | undefined): string | null {
  if (plaintext == null || plaintext === "") return null;

  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

/**
 * Decrypt a ciphertext produced by `encryptSecret`. Returns `null` for
 * null/empty input. Throws on tampering (GCM auth tag mismatch), which
 * is exactly what we want — better to fail loudly than to return
 * mangled bytes.
 */
export function decryptSecret(ciphertext: string | null | undefined): string | null {
  if (ciphertext == null || ciphertext === "") return null;

  const parts = ciphertext.split(":");
  if (parts.length !== 4) {
    throw new Error("Malformed ciphertext: wrong part count");
  }
  const [version, ivB64, tagB64, dataB64] = parts;
  if (version !== VERSION) {
    throw new Error(`Unsupported ciphertext version: ${version}`);
  }

  const key = getKey();
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * Generate a fresh base64-encoded 32-byte key. Used by the one-off dev
 * bootstrap command so you don't have to remember the node -e incantation.
 */
export function generateEncryptionKey(): string {
  return "base64:" + randomBytes(KEY_LENGTH).toString("base64");
}
