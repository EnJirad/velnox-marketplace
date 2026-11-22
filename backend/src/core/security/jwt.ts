import { createHmac, timingSafeEqual } from "node:crypto";

export interface JwtHeader {
  readonly alg: "HS256";
  readonly typ: "JWT";
}

export interface JwtPayload {
  readonly sub: string;
  readonly jti: string;
  readonly iat: number;
  readonly exp: number;
  [key: string]: any;
}

export interface VerifyJwtResult<T> {
  readonly valid: boolean;
  readonly payload?: T;
  readonly error?: "EXPIRED" | "INVALID_SIGNATURE" | "MALFORMED";
}

function base64url(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function fromBase64url(input: string): string {
  let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  return Buffer.from(base64, "base64").toString("utf8");
}

/**
 * Pure cryptographic HS256 JWT signer without external dependencies.
 * Zero-dependency, edge-compatible, timing-safe.
 */
export function signJwt(
  payload: Record<string, any>,
  secret: string,
  expiresInSeconds: number,
): string {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtPayload = {
    ...payload,
    sub: payload.sub ?? payload.userId,
    jti: payload.jti ?? crypto.randomUUID(),
    iat: now,
    exp: now + expiresInSeconds,
  };

  const headerStr = JSON.stringify({ alg: "HS256", typ: "JWT" });
  const payloadStr = JSON.stringify(fullPayload);

  const encodedHeader = base64url(headerStr);
  const encodedPayload = base64url(payloadStr);
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signature = createHmac("sha256", secret).update(signingInput).digest();
  const encodedSignature = base64url(signature);

  return `${signingInput}.${encodedSignature}`;
}

/**
 * Pure cryptographic HS256 JWT verifier with timing-safe signature comparison.
 */
export function verifyJwt<T extends JwtPayload = JwtPayload>(
  token: string,
  secret: string,
): VerifyJwtResult<T> {
  if (!token || typeof token !== "string") {
    return { valid: false, error: "MALFORMED" };
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return { valid: false, error: "MALFORMED" };
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  // 1. Verify signature with timing-safe comparison
  const expectedSig = createHmac("sha256", secret).update(signingInput).digest();
  let receivedSig: Buffer;
  try {
    let b64 = encodedSignature.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4 !== 0) b64 += "=";
    receivedSig = Buffer.from(b64, "base64");
  } catch {
    return { valid: false, error: "MALFORMED" };
  }

  if (expectedSig.length !== receivedSig.length || !timingSafeEqual(expectedSig, receivedSig)) {
    return { valid: false, error: "INVALID_SIGNATURE" };
  }

  // 2. Parse payload
  let payload: T;
  try {
    payload = JSON.parse(fromBase64url(encodedPayload));
  } catch {
    return { valid: false, error: "MALFORMED" };
  }

  // 3. Verify expiry
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    return { valid: false, payload, error: "EXPIRED" };
  }

  return { valid: true, payload };
}
