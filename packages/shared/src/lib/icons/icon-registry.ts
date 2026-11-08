/**
 * icon-registry.ts — identifier parsing and resolution for the local icon
 * library.
 *
 * Understands:
 *   - Iconify canonical: "prefix:name"      (e.g. "mdi:shopping")
 *   - Bare name (no colon)                  (legacy Lucide "shopping-bag")
 *   - PascalCase / "Icon"-suffixed legacy   (e.g. "ShoppingBag", "CartIcon")
 *   - Image URLs (http / https / data:)    → handled as images, never as icons
 *
 * Parsing and name-shape detection are pure and synchronous here; body
 * resolution is handled by icon-loader (async, on-demand).
 */
import type { ResolvedIcon } from "./icon-types";
import { isKnownPrefix } from "./icon-collections";

/** True when a candidate is an image URL / data URI (renders as <img>). */
export function isImageLike(value: string): boolean {
  return (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("data:")
  );
}

/** kebab-case → PascalCase (e.g. "shopping-bag" → "ShoppingBag"). */
export function kebabToPascal(name: string): string {
  return name
    .split("-")
    .map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : p))
    .join("");
}

/** PascalCase / "Icon"-suffixed → kebab-case (e.g. "ShoppingBag" → "shopping-bag"). */
export function pascalToKebab(name: string): string {
  return name
    .replace(/Icon$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
}

const COLON_RE = /^([a-z0-9][a-z0-9-]*):(.*)$/i;

/**
 * Parse an identifier into { prefix, name } when it is an Iconify-style
 * "prefix:name". Returns null when there is no colon or the prefix is unknown
 * (a bare "shopping-bag" is NOT prefix:name — treated as legacy).
 */
export function parseIconifyId(
  value: string,
): { prefix: string; name: string } | null {
  const m = COLON_RE.exec(value);
  if (!m) return null;
  const [, prefix, name] = m;
  if (!isKnownPrefix(prefix)) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  return { prefix, name: trimmed };
}

/**
 * Normalize any legacy/unknown Lucide-style name to kebab-case. Used to keep
 * the curated legacy set + Iconify stable across PascalCase variants.
 */
export function normalizeLegacyName(value: string): string {
  return pascalToKebab(value.trim()).replace(/^\//, "");
}

/**
 * Resolve an identifier to a stable canonical identifier without loading any
 * icon body data. Returns:
 *   kind "image"    → url
 *   kind "iconify"  → prefix + name (canonical kebab id)
 *   kind "unknown"  → identifier as given
 */
export function resolveIdentifier(value: string | null | undefined): ResolvedIcon {
  const raw = (value ?? "").trim();
  if (!raw) return { kind: "unknown", identifier: "" };

  if (isImageLike(raw)) {
    return { kind: "image", identifier: raw, url: raw };
  }

  // Iconify "prefix:name" (only when prefix is a known collection).
  const prefixed = parseIconifyId(raw);
  if (prefixed) {
    return {
      kind: "iconify",
      identifier: `${prefixed.prefix}:${prefixed.name}`,
      prefix: prefixed.prefix,
      name: prefixed.name,
    };
  }

  // Bare value: legacy Lucide style or Iconify name from a default collection.
  // Treated as an Iconify "lucide:" identifier so the renderer resolves it via
  // the loader, keeping old category values working.
  const name = normalizeLegacyName(raw);
  return {
    kind: "iconify",
    identifier: name ? `lucide:${name}` : "lucide:package",
    prefix: "lucide",
    name: name || "package",
  };
}
