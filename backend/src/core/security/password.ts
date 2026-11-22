import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const COST = 16384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 32;

/**
 * Hash a plaintext password using scrypt.
 * Stores in the format: `$scrypt$16384$8$1$salt$hash`
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
 * Verifies a plaintext password against the stored scrypt hash with timing-safe comparison.
 */
export async function verifyPassword(plaintext: string, storedHash: string): Promise<boolean> {
  if (!storedHash || typeof storedHash !== "string") return false;

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
