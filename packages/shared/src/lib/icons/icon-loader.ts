/**
 * icon-loader.ts — on-demand loader for the local, offline icon library.
 *
 * Icon body data lives in generated JSON assets under ./generated/icons/. Each
 * collection is its own asset and is loaded ONLY when first needed (search a
 * collection, render one of its icons), then cached in memory. The per-collection
 * `import()` calls are static, so every bundler (Vite) code-splits them into
 * lazy chunks — none of them ship in the initial application bundle.
 *
 * No runtime request ever leaves the app: assets are committed to the repo.
 */
import { ICON_COLLECTION_MAP } from "./icon-collections";
import type { IconBodyData } from "./icon-types";

/** Map of loaded collection data: collection prefix → { icons, aliases }. */
export interface LoadedCollectionData {
  icons: Record<string, IconBodyData>;
  aliases: Record<string, string>;
}

const cache = new Map<string, LoadedCollectionData>();

/**
 * Static dynamic imports — each becomes its own lazy chunk.
 * Keep in sync with the generated filenames (scripts/generate-icon-library.mjs).
 */
const importers: Record<string, () => Promise<{ default: unknown }>> = {
  lucide: () => import("./generated/icons/lucide.json"),
  mdi: () => import("./generated/icons/mdi.json"),
  tabler: () => import("./generated/icons/tabler.json"),
  ph: () => import("./generated/icons/ph.json"),
  "fa6-solid": () => import("./generated/icons/fa6-solid.json"),
};

/** Collection prefixes that have on-demand loaders. */
export const LOADABLE_PREFIXES: string[] = Object.keys(importers);

function normalize(data: unknown): LoadedCollectionData {
  const d = data as LoadedCollectionData;
  return {
    icons: d.icons ?? {},
    aliases: d.aliases ?? {},
  };
}

/**
 * Load a collection's icon data into memory (idempotent, cached).
 * Resolves immediately when already loaded. Never throws for a known prefix.
 */
export async function loadCollection(prefix: string): Promise<LoadedCollectionData> {
  const cached = cache.get(prefix);
  if (cached) return cached;

  const importer = importers[prefix];
  if (!importer) {
    // Unknown collection → empty data so the renderer falls back gracefully.
    return { icons: {}, aliases: {} };
  }

  const mod = await importer();
  const data = normalize(mod.default);
  cache.set(prefix, data);
  return data;
}

/** True when a collection's body data is already resident in memory. */
export function isCollectionLoaded(prefix: string): boolean {
  return cache.has(prefix);
}

/** Total bytes currently held in the memory cache (approx, for audits). */
export function cacheStats(): { collections: number; prefixes: string[] } {
  return { collections: cache.size, prefixes: [...cache.keys()] };
}

/**
 * Resolve a single icon body by canonical identifier ("prefix:name" or bare
 * name resolved against a default collection). Aliases are resolved to their
 * parent icon. Returns the body data or undefined.
 */
export async function resolveIconBody(
  prefix: string,
  name: string,
): Promise<IconBodyData | undefined> {
  if (!ICON_COLLECTION_MAP.has(prefix)) return undefined;

  let data = cache.get(prefix);
  if (!data) {
    data = await loadCollection(prefix);
    if (!data) return undefined;
  }

  const direct = data.icons[name];
  if (direct) return direct;

  // Alias → parent (aliases may chain; guard against cycles).
  const seen = new Set<string>();
  let cur: string | undefined = name;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const parentName: string | undefined = data.aliases[cur];
    if (!parentName) break;
    const resolved: IconBodyData | undefined = data.icons[parentName];
    if (resolved) return resolved;
    cur = parentName;
  }
  return undefined;
}
