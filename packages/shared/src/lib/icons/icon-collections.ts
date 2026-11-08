/**
 * icon-collections.ts — collection registry built from the local generated
 * manifest. This module imports ONLY the tiny manifest (collection metadata);
 * icon body data is never loaded here (see icon-loader).
 */
import type { IconCollectionInfo } from "./icon-types";
// Generated at build time by scripts/generate-icon-library.mjs.
import manifest from "./generated/manifest.json";

/** All collections known to the local library. */
export const ICON_COLLECTIONS: IconCollectionInfo[] = manifest as IconCollectionInfo[];

/** collection prefix → info. */
export const ICON_COLLECTION_MAP: Map<string, IconCollectionInfo> = new Map(
  ICON_COLLECTIONS.map((c) => [c.prefix, c]),
);

/** Sorted, human-readable labels for the picker selector. */
export const ICON_COLLECTION_LABELS: { prefix: string; name: string; total: number }[] =
  ICON_COLLECTIONS.map((c) => ({ prefix: c.prefix, name: c.name, total: c.total }));

/** All collection prefixes. */
export const ICON_COLLECTION_PREFIXES: string[] = ICON_COLLECTIONS.map((c) => c.prefix);

/** Total primary icons across all collections. */
export const ICON_TOTAL_COUNT: number = ICON_COLLECTIONS.reduce((n, c) => n + c.total, 0);

export function getCollection(prefix: string): IconCollectionInfo | undefined {
  return ICON_COLLECTION_MAP.get(prefix);
}

export function isKnownPrefix(prefix: string): boolean {
  return ICON_COLLECTION_MAP.has(prefix);
}

/** True when a bare identifier (no colon) may be a valid collection prefix. */
export function isValidCollectionPrefix(value: string): boolean {
  return /^[a-z0-9-]+$/i.test(value) && isKnownPrefix(value);
}
