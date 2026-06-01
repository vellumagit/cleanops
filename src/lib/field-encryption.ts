/**
 * Field-level encryption helpers.
 *
 * Used to protect free-text fields that might contain customer notes,
 * personal details, or other sensitive data we'd rather not be plaintext
 * in a Postgres dump or visible to anyone with raw database access.
 *
 * Wraps the existing AES-256-GCM helpers from lib/crypto.ts (which power
 * OAuth-token encryption) — same key (INTEGRATION_ENCRYPTION_KEY), same
 * algorithm, same wire format.
 *
 * LAZY MIGRATION
 * --------------
 * We don't need a backfill migration to encrypt every existing row at
 * once. Every plaintext value already in the database is left alone
 * until something writes it again. Because lib/crypto's ciphertext
 * always begins with the literal "v1:", we can tell encrypted from
 * legacy plaintext by checking that prefix on read.
 *
 *   encryptField("hello")          → "v1:<iv>:<tag>:<ct>"
 *   maybeDecryptField("v1:...")    → "hello"
 *   maybeDecryptField("plain")     → "plain"     (legacy, unencrypted)
 *   maybeDecryptField(null)        → null
 *
 * The first time a value is saved through an action that uses
 * encryptField(), it becomes ciphertext. Subsequent reads decrypt
 * transparently. Old rows stay readable in the meantime — no big-bang
 * migration risk.
 *
 * THREAT MODEL
 * ------------
 * Protects against:
 *   - Stolen Postgres backups / snapshots
 *   - Read access to the database without the application's encryption key
 *   - Supabase staff with row-level access (key is in Vercel env, not in DB)
 *
 * Does NOT protect against:
 *   - A compromise of the Vercel environment (key is there)
 *   - Anyone with valid app credentials (the app decrypts and displays)
 *   - Side-channel timing attacks on the decrypt path
 *
 * The goal is "Postgres compromise alone is insufficient to read sensitive
 * notes." It is not "perfect secrecy from internal users."
 */

import "server-only";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

/**
 * Structural check for the v1 wire format: `v1:<iv>:<tag>:<ct>` where
 * each segment is non-empty base64. Used to distinguish ciphertext
 * from legacy plaintext that happens to start with "v1:".
 *
 * The naive prefix check (startsWith("v1:")) would treat a user-
 * entered "v1: see invoice for details" as ciphertext and try to
 * decrypt it on read. With the structural check it's correctly
 * detected as plaintext and passed through.
 *
 * We accept both standard base64 (A-Z a-z 0-9 + / =) and URL-safe
 * base64 (A-Z a-z 0-9 - _) so future encrypt() implementations that
 * switch alphabets don't break detection.
 */
const CIPHERTEXT_PATTERN =
  /^v1:[A-Za-z0-9+/=_-]+:[A-Za-z0-9+/=_-]+:[A-Za-z0-9+/=_-]+$/;

/**
 * Encrypt a string for storage. Returns null for null/empty so callers
 * can chain unconditionally: `notes: encryptField(input)`.
 *
 * Idempotent: if the input already looks like ciphertext (begins with
 * the v1: marker), it's returned unchanged. Prevents accidental
 * double-encryption when an action re-saves a value it just read.
 */
export function encryptField(
  plaintext: string | null | undefined,
): string | null {
  if (plaintext == null || plaintext === "") return null;
  if (isFieldEncrypted(plaintext)) return plaintext;
  return encryptSecret(plaintext);
}

/**
 * Decrypt a stored value, transparently handling legacy plaintext.
 * Returns null for null/empty.
 *
 * On decrypt error the default behavior is to fall back to the raw
 * ciphertext so an admin reading their own data can see SOMETHING and
 * understand that a row is unreadable. For PUBLIC-facing pages, pass
 * `{ publicFallback: true }` — we return `null` instead so customers
 * never see "v1:abc..." in an invoice or a quote PDF after a botched
 * key rotation.
 */
export function maybeDecryptField(
  value: string | null | undefined,
  options: { publicFallback?: boolean } = {},
): string | null {
  if (value == null || value === "") return null;
  if (!isFieldEncrypted(value)) return value; // legacy plaintext
  try {
    return decryptSecret(value);
  } catch (err) {
    console.error(
      "[field-encryption] decrypt failed; falling back",
      err,
    );
    return options.publicFallback ? null : value;
  }
}

/**
 * Structural check for our v1 GCM wire format. A literal "v1:..."
 * substring in user-entered text won't fool this; only a value with
 * the full `v1:<iv>:<tag>:<ct>` shape matches. See CIPHERTEXT_PATTERN.
 */
export function isFieldEncrypted(value: string): boolean {
  return CIPHERTEXT_PATTERN.test(value);
}

/**
 * Map helper for batch read sites — applies maybeDecryptField over a list,
 * leaves nulls in place.
 */
export function maybeDecryptFields(
  values: Array<string | null | undefined>,
): Array<string | null> {
  return values.map((v) => maybeDecryptField(v));
}
