/**
 * Velnox Icon Library — public API.
 *
 * Offline-first, on-demand local icon system built from official Iconify
 * collections. No runtime requests to Iconify servers: all data is generated
 * locally (scripts/generate-icon-library.mjs) and committed.
 *
 * Public surface (synchronous registry + async loaders):
 *   - collections / licenses metadata
 *   - identifier resolution (Iconify prefix:name + legacy Lucide + URLs)
 *   - on-demand collection data loading (code-split lazy chunks)
 *   - paginated search over the local name index
 *   - safe SVG renderer + the high-level <LibraryIcon> component
 */
export * from "./icon-types";
export * from "./icon-collections";
export * from "./icon-licenses";
export * from "./icon-registry";
export { loadCollection, resolveIconBody, isCollectionLoaded, LOADABLE_PREFIXES } from "./icon-loader";
export type { LoadedCollectionData } from "./icon-loader";
export {
  searchIcons,
  loadCollectionNames,
  prefetchNames,
  searchablePrefixes,
  isSearchIndexLoaded,
} from "./icon-search";
export type { SearchOptions, SearchPage, IconSearchResult } from "./icon-types";
export { IconSvg } from "./icon-render";
export type { IconSvgProps } from "./icon-render";
export { LibraryIcon } from "./library-icon";
export type { LibraryIconProps } from "./library-icon";

export { ICON_TOTAL_COUNT };
