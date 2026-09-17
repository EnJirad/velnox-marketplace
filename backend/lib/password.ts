/**
 * Password hashing using Node.js built-in `crypto.scrypt`.
 *
 * No external dependencies (bcrypt/argon2) required — scrypt is part of
 * the Node.js crypto module and provides strong, well-studied key derivation.
 *
 * Format stored in DB: `$scrypt$N$r$p$salt$hash`
 *   N = cost factor (16384), r = block size (8), p = parallelization (1)
 *   salt = 32-byte random hex, hash = 64-byte derived key hex
 */

import { randomBytes, scrypt, timingSafeEqual } from "crypto";

const COST = 16384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 32;

/**
 * Hash a plaintext password. Returns the encoded string to store in the DB.
 * Never returns the plaintext.
 */
export async function hashPassword(plaintext: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH).toString("hex");
  const derived = await new Promise<Buffer>((resolve, reject) => {
    scrypt(plaintext, salt, KEY_LENGTH, { N: COST, r: BLOCK_SIZE, p: PARALLELIZATION }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
  return `$scrypt$${COST}$${BLOCK_SIZE}$${PARALLELIZATION}$${salt}$${derived.toString("hex")}`;
}

/**
 * Verify a plaintext password against the stored hash.
 * Returns true if the password matches, false otherwise.
 * Timing-safe comparison to prevent timing attacks.
 */
export async function verifyPassword(plaintext: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split("$");
  // Format: $scrypt$N$r$p$salt$hash
  if (parts.length !== 7 || parts[1] !== "scrypt") return false;

  const N = parseInt(parts[2]!, 10);
  const r = parseInt(parts[3]!, 10);
  const p = parseInt(parts[4]!, 10);
  const salt = parts[5]!;
  const expectedHex = parts[6]!;

  const expected = Buffer.from(expectedHex, "hex");
  const derived = await new Promise<Buffer>((resolve, reject) => {
    scrypt(plaintext, salt, expected.length, { N, r, p }, (err, key) => {
      if (err) reject(err);
      else resolve(key as Buffer);
    });
  });

  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/**
 * Check if a stored hash is in the expected scrypt format.
 * Used to distinguish password-auth users from OAuth-only users.
 */
export function isPasswordHashFormat(stored: string | null): boolean {
  return typeof stored === "string" && stored.startsWith("$scrypt$");
}
