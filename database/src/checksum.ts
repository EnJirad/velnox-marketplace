import { createHash } from "node:crypto";

/**
 * Computes a deterministic SHA-256 checksum of a migration file's contents.
 * Normalizes line endings (\r\n -> \n) so checksums remain identical across platforms.
 */
export function calculateChecksum(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}
