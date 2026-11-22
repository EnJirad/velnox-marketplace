/**
 * Web Crypto PBKDF2 Password Hashing & Verification
 * Standard format: $pbkdf2-sha256$i=100000$salt$hash
 */

const ITERATIONS = 100_000;
const KEY_LENGTH_BYTES = 32;
const SALT_LENGTH_BYTES = 16;

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, "0");
  }
  return hex;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
  const passwordBytes = new TextEncoder().encode(password);

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    passwordBytes,
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt as any,
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    KEY_LENGTH_BYTES * 8,
  );

  const hashHex = bytesToHex(new Uint8Array(derivedBits));
  const saltHex = bytesToHex(salt);

  return `$pbkdf2-sha256$i=${ITERATIONS}$${saltHex}$${hashHex}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash || !storedHash.startsWith("$pbkdf2-sha256$")) {
    return false;
  }

  const parts = storedHash.split("$");
  // parts: ["", "pbkdf2-sha256", "i=100000", "<saltHex>", "<hashHex>"]
  if (parts.length !== 5) {
    return false;
  }

  const iterPart = parts[2]!;
  const saltHex = parts[3]!;
  const expectedHashHex = parts[4]!;

  const iterations = parseInt(iterPart.replace("i=", ""), 10);
  if (isNaN(iterations) || iterations < 10_000) {
    return false;
  }

  const salt = hexToBytes(saltHex);
  const expectedHashBytes = hexToBytes(expectedHashHex);
  const passwordBytes = new TextEncoder().encode(password);

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    passwordBytes,
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt as any,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    KEY_LENGTH_BYTES * 8,
  );

  return timingSafeEqual(new Uint8Array(derivedBits), expectedHashBytes);
}

export function generateSecureToken(byteLength: number = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return bytesToHex(bytes);
}

export async function hashToken(token: string): Promise<string> {
  const tokenBytes = new TextEncoder().encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", tokenBytes);
  return bytesToHex(new Uint8Array(hashBuffer));
}
