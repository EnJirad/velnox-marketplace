/**
 * icon-licenses.ts — licensing + attribution for every collection bundled in
 * the local Velnox icon library. Sourced from the official Iconify
 * `@iconify-json/<prefix>/info.json` files (verified at generation time) — never typed
 * by hand from memory.
 *
 * All five collections permit commercial use:
 *   lucide    → ISC
 *   mdi       → Apache-2.0
 *   tabler    → MIT
 *   ph        → MIT
 *   fa6-solid → CC-BY-4.0 (attribution required)
 */
import type { IconLicenseInfo } from "./icon-types";
import { ICON_COLLECTIONS } from "./icon-collections";

/** License info keyed by collection prefix (from the manifest). */
export const ICON_LICENSES: Record<string, IconLicenseInfo> = {};

for (const c of ICON_COLLECTIONS) {
  if (c.license) {
    ICON_LICENSES[c.prefix] = c.license;
  }
}

/** Human-readable one-line attribution for a collection. */
export function collectionLicenseLine(prefix: string): string {
  const c = ICON_LICENSES[prefix];
  if (!c) return "License: unknown";
  const spdx = c.spdx ?? c.title;
  const author = ICON_COLLECTIONS.find((x) => x.prefix === prefix)?.author;
  const by = author?.name ? ` · ${author.name}` : "";
  return `${spdx}${by}`;
}

/** Full attribution block (used on a picker footer / about). */
export function attributionBlock(prefix: string): string {
  const c = ICON_COLLECTIONS.find((x) => x.prefix === prefix);
  if (!c) return "";
  const lic = c.license;
  const bits = [
    `Collection: ${c.name} (${c.prefix})`,
    `Icons: ${c.total}`,
    lic ? `License: ${lic.spdx ?? lic.title}` : null,
    lic?.url ? `License URL: ${lic.url}` : null,
    c.author?.name ? `Author: ${c.author.name}` : null,
    c.author?.url ? `Source: ${c.author.url}` : null,
  ].filter(Boolean);
  return bits.join("\n");
}
