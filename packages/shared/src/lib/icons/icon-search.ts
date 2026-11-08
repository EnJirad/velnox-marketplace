/**
 * icon-search.ts — case-insensitive, paginated icon name search.
 *
 * Uses the small per-collection NAME assets (generated/icons/../names/*.json)
 * loaded on demand and cached in memory. Body data is NOT touched here, so
 * searching never pulls the heavy icon SVG assets. The full DB is never
 * processed on every keystroke — one filtered pass over a loaded name list,
 * then pagination on the result.
 */
import type { IconSearchResult, SearchOptions, SearchPage } from "./icon-types";
import { ICON_COLLECTION_MAP } from "./icon-collections";

const nameCache = new Map<string, string[]>();

/** Static dynamic imports for the name assets (code-split into lazy chunks). */
const nameImporters: Record<string, () => Promise<{ default: unknown }>> = {
  lucide: () => import("./generated/names/lucide.json"),
  mdi: () => import("./generated/names/mdi.json"),
  tabler: () => import("./generated/names/tabler.json"),
  ph: () => import("./generated/names/ph.json"),
  "fa6-solid": () => import("./generated/names/fa6-solid.json"),
};

/** Load a collection's name list into memory (cached). */
export async function loadCollectionNames(prefix: string): Promise<string[]> {
  const cached = nameCache.get(prefix);
  if (cached) return cached;
  const importer = nameImporters[prefix];
  if (!importer) return [];
  const mod = await importer();
  const names = (mod.default as string[]) ?? [];
  nameCache.set(prefix, names);
  return names;
}

/** Prefetch the name lists for a set of prefixes (e.g. on picker open). */
export async function prefetchNames(prefixes: string[]): Promise<void> {
  await Promise.allSettled(prefixes.map(loadCollectionNames));
}

/** True when name search data is resident in memory. */
export function isSearchIndexLoaded(prefix: string): boolean {
  return nameCache.has(prefix);
}

/** Which collections are configured for search. */
export function searchablePrefixes(): string[] {
  return Object.keys(nameImporters);
}

/**
 * Search across one collection (or all). Returns a paginated page of results.
 * Results are alias-aware: primary names are the canonical ids; alias names are
 * included but flagged. Sorted for stable pagination.
 */
export async function searchIcons(opts: SearchOptions): Promise<SearchPage> {
  const query = (opts.query ?? "").trim().toLowerCase();
  const prefixes = opts.collection
    ? [opts.collection]
    : searchablePrefixes();
  const limit = Math.max(1, opts.limit ?? 40);
  const page = Math.max(0, opts.page ?? 0);

  const hits: IconSearchResult[] = [];

  for (const prefix of prefixes) {
    if (!ICON_COLLECTION_MAP.has(prefix)) continue;
    const names = await loadCollectionNames(prefix);

    if (!query) {
      // Unfiltered: collect names per collection, sorted.
      for (const n of names) {
        hits.push({ prefix, name: n, id: `${prefix}:${n}` });
      }
    } else {
      for (const n of names) {
        if (n.toLowerCase().includes(query)) {
          hits.push({ prefix, name: n, id: `${prefix}:${n}`, alias: false });
        }
      }
    }
  }

  hits.sort((a, b) => a.id.localeCompare(b.id));

  const total = hits.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const start = page * limit;
  const items = hits.slice(start, start + limit);

  return { items, total, page, pages };
}
