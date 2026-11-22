/**
 * Pure Web Crypto JWT Engine for Cloudflare Workers
 * Uses standard crypto.subtle with HMAC-SHA256 (HS256)
 */

export interface JwtHeader {
  alg: "HS256";
  typ: "JWT";
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  name?: string;
  type: "access" | "refresh";
  iat?: number;
  exp?: number;
  [key: string]: unknown;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function textToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function bytesToText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

async function getCryptoKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    textToBytes(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signJwt(
  payload: JwtPayload,
  secret: string,
  expiresInSeconds: number = 900, // 15 mins default
): Promise<string> {
  if (!secret || secret.length < 16) {
    throw new Error("JWT secret must be at least 16 characters long.");
  }

  const header: JwtHeader = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);

  const fullPayload: JwtPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const encodedHeader = base64UrlEncode(textToBytes(JSON.stringify(header)));
  const encodedPayload = base64UrlEncode(textToBytes(JSON.stringify(fullPayload)));
  const dataToSign = `${encodedHeader}.${encodedPayload}`;

  const key = await getCryptoKey(secret);
  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    textToBytes(dataToSign),
  );
  const encodedSignature = base64UrlEncode(new Uint8Array(signatureBytes));

  return `${dataToSign}.${encodedSignature}`;
}

export async function verifyJwt(
  token: string,
  secret: string,
): Promise<JwtPayload> {
  if (!secret || secret.length < 16) {
    throw new Error("JWT secret must be at least 16 characters long.");
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed JWT: expected 3 segments.");
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  if (!headerB64 || !payloadB64 || !signatureB64) {
    throw new Error("Malformed JWT: empty segment found.");
  }

  // Parse header
  let header: JwtHeader;
  try {
    header = JSON.parse(bytesToText(base64UrlDecode(headerB64)));
  } catch {
    throw new Error("Malformed JWT: invalid header JSON.");
  }

  if (header.alg !== "HS256" || header.typ !== "JWT") {
    throw new Error(`Unsupported JWT algorithm: ${header.alg}`);
  }

  // Verify HMAC signature
  const key = await getCryptoKey(secret);
  const dataToVerify = `${headerB64}.${payloadB64}`;
  const signatureBytes = base64UrlDecode(signatureB64);

  const isValid = await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes as any,
    textToBytes(dataToVerify),
  );

  if (!isValid) {
    throw new Error("Invalid JWT signature.");
  }

  // Parse payload
  let payload: JwtPayload;
  try {
    payload = JSON.parse(bytesToText(base64UrlDecode(payloadB64)));
  } catch {
    throw new Error("Malformed JWT: invalid payload JSON.");
  }

  // Expiration check
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    throw new Error("JWT has expired.");
  }

  return payload;
}
