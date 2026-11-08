/**
 * icon-types.ts — shared type definitions for the Velnox icon library.
 *
 * Pure types only (no runtime code, no React, no imports) so they can be used
 * across every app and in unit tests.
 */

/** A single SVG icon body loaded from local generated data. */
export interface IconBodyData {
  /** Inner SVG markup (paths/groups), WITHOUT the <svg> wrapper. */
  body: string;
  /** Width when it differs from the collection default (optional). */
  w?: number;
  /** Height when it differs from the collection default (optional). */
  h?: number;
}

/** License metadata for a collection (from the official Iconify info.json). */
export interface IconLicenseInfo {
  title: string;
  spdx?: string | null;
  url?: string | null;
}

/** Author/attribution metadata for a collection. */
export interface IconAuthorInfo {
  name: string;
  url?: string | null;
}

/** A resolved collection entry in the local manifest. */
export interface IconCollectionInfo {
  /** Iconify collection prefix, e.g. "mdi", "lucide", "ph". */
  prefix: string;
  /** Human-readable collection name. */
  name: string;
  /** Number of primary (non-alias) icons. */
  total: number;
  /** Number of alias names. */
  aliases: number;
  /** Default icon height (pm 24 for most stroke sets). */
  height: number | null;
  /** Collection version. */
  version?: string | null;
  license?: IconLicenseInfo | null;
  author?: IconAuthorInfo | null;
  /** Sample icon names. */
  samples?: string[] | null;
  /** Alias name → parent icon name (used for resolution). */
  aliasesMap?: Record<string, string>;
}

/** Runtime registry entry — manifest info + lazy loader handle. */
export interface IconCollectionRuntime extends IconCollectionInfo {
  /** Whether icon body data is currently loaded in memory. */
  loaded: boolean;
  /** Loads the collection body data (idempotent, cached). */
  load: () => Promise<void>;
}

/**
 * A parsed icon identifier after resolution. The renderer/consumer uses this to
 * decide HOW to render (local SVG vs image URL vs fallback).
 */
export type ResolvedIconKind = "iconify" | "image" | "unknown";

export interface ResolvedIcon {
  kind: ResolvedIconKind;
  /** Canonical identifier, e.g. "mdi:shopping" or the raw URL. */
  identifier: string;
  /** Collection prefix for iconify identifiers (e.g. "mdi"). */
  prefix?: string;
  /** Icon name within the collection (e.g. "shopping"). */
  name?: string;
  /** Image URL when kind === "image". */
  url?: string;
}

/** A search hit returned by icon-search.ts. */
export interface IconSearchResult {
  /** Collection prefix. */
  prefix: string;
  /** Icon identifier WITHOUT prefix — raw name. */
  name: string;
  /** Canonical identifier WITH prefix, e.g. "mdi:shopping". */
  id: string;
  /** True when this hit is an alias, not a primary icon. */
  alias?: boolean;
}

export interface SearchOptions {
  /** Case-insensitive substring. Empty = list first page. */
  query?: string;
  /** Restrict to a single collection prefix (or all). */
  collection?: string;
  /** Page size for pagination. */
  limit?: number;
  /** 0-based page index. */
  page?: number;
}

export interface SearchPage {
  items: IconSearchResult[];
  total: number;
  page: number;
  pages: number;
}
