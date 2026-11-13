/**
 * Banner contract v2 — the pure rules behind `platform_settings.shop_announcements`.
 *
 * Lives in `lib/` (no `db`, no `express` imports) so the rules are unit-testable
 * without a database and shared by the admin write path and the public read.
 *
 * v1 rows (`{title, description, linkUrl, active, sortOrder}`) are mapped on
 * read AND write; a v1 row with a title stays valid forever. Unknown `type` /
 * `placement` and rule violations are REJECTED with the item index — v1 silently
 * dropped invalid items, which made "empty banner rejected" indistinguishable
 * from "empty banner disappeared".
 *
 * Placement keys (grouped by `zone`):
 *   home   : home_hero (hero carousel), home_strip (compact promo strip)
 *   product: product_above_gallery, product_below_image, product_below_price,
 *            product_above_tabs
 *   store  : store_header, store_above_products, store_between_products
 *
 * `zone` groups placements by storefront page so the frontend can fetch one
 * zone and render all its banners without scanning every placement. `slot`
 * orders banners within one placement. `animation` / `bgColor` / `textColor`
 * are optional presentational hints for announcement-style banners.
 */

export const BANNER_MAX_ITEMS = 10;

export const BANNER_TYPES = ["announcement", "promotion", "ad"] as const;
export const BANNER_PLACEMENTS = [
  "home_hero",
  "home_strip",
  "product_above_gallery",
  "product_below_image",
  "product_below_price",
  "product_above_tabs",
  "store_header",
  "store_above_products",
  "store_between_products",
] as const;

export const BANNER_ZONES = ["home", "product", "store"] as const;
export const BANNER_ANIMATIONS = ["none", "fade", "slide-up", "bounce"] as const;

export type BannerType = (typeof BANNER_TYPES)[number];
export type BannerPlacement = (typeof BANNER_PLACEMENTS)[number];
export type BannerZone = (typeof BANNER_ZONES)[number];
export type BannerAnimation = (typeof BANNER_ANIMATIONS)[number];

export interface Banner {
  id: string;
  type: BannerType;
  zone: BannerZone;
  placement: BannerPlacement;
  slot: number;
  title: string;
  subtitle: string;
  imageUrl: string | null;
  ctaLabel: string;
  ctaUrl: string | null;
  active: boolean;
  sortOrder: number;
  startsAt: string | null;
  endsAt: string | null;
  animation: BannerAnimation;
  bgColor: string | null;
  textColor: string | null;
}

export interface BannerRejection {
  index: number;
  reason: string;
}

export interface NormaliseResult {
  items: Banner[];
  rejections: BannerRejection[];
}

const MAX_ID = 64;
const MAX_TITLE = 120;
const MAX_SUBTITLE = 240;
const MAX_CTA_LABEL = 32;
const MAX_URL = 1000;

function asText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function asUrl(value: unknown): { url: string | null; invalid: boolean } {
  if (typeof value !== "string") return { url: null, invalid: false };
  const raw = value.trim();
  if (!raw) return { url: null, invalid: false };
  // Only http(s) images and in-app paths — never javascript: or data: payloads.
  if (raw.startsWith("/")) return { url: raw.slice(0, MAX_URL), invalid: false };
  if (/^https?:\/\//i.test(raw)) return { url: raw.slice(0, MAX_URL), invalid: false };
  // The editor SENT a value we refuse — say so instead of letting it degrade
  // into a misleading "banner is empty".
  return { url: null, invalid: true };
}

/** Deterministic fallback id from the row's content — no cross-row collisions. */
function fallbackId(seed: string): string {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h * 33) ^ seed.charCodeAt(i)) >>> 0;
  return `bn${h.toString(36)}`;
}

/** Non-empty means "counts as content" for the at-least-one rule. */
function hasContent(value: string | null): boolean {
  return value !== null && value.length > 0;
}

function asIsoDate(value: unknown): string | null | undefined {
  // Absent (undefined/null/empty) = unbounded → null. Only a MALFORMED string
  // (a real value the editor sent but we cannot parse) is invalid → undefined.
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const raw = value.trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function zoneForPlacement(placement: BannerPlacement): BannerZone {
  if (placement.startsWith("product_")) return "product";
  if (placement.startsWith("store_")) return "store";
  return "home";
}

/**
 * Map a stored (possibly v1) row onto the v2 shape. Returns `undefined` when the
 * row is not an object at all — the caller reports that as a rejection.
 */
function fromLegacy(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  if (out.subtitle === undefined && typeof row.description === "string") {
    out.subtitle = row.description;
  }
  if (out.ctaUrl === undefined && row.linkUrl !== undefined) {
    out.ctaUrl = row.linkUrl;
  }
  if (out.type === undefined) out.type = "announcement";
  if (out.placement === undefined) out.placement = "home_hero";
  // New v2 fields are optional on write; sensible defaults apply below.
  if (out.zone === undefined) out.zone = zoneForPlacement(out.placement as BannerPlacement);
  if (out.slot === undefined) out.slot = 0;
  if (out.animation === undefined) out.animation = "none";
  if (out.bgColor === undefined) out.bgColor = null;
  if (out.textColor === undefined) out.textColor = null;
  return out;
}

export function normaliseBanners(input: unknown): NormaliseResult {
  const rejections: BannerRejection[] = [];
  if (!Array.isArray(input)) return { items: [], rejections };

  const items: Banner[] = [];
  input.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") {
      rejections.push({ index, reason: "not an object" });
      return;
    }
    const row = fromLegacy(raw as Record<string, unknown>);

    const title = asText(row.title, MAX_TITLE);
    const subtitle = asText(row.subtitle, MAX_SUBTITLE);
    const imageUrlResult = asUrl(row.imageUrl);
    const ctaLabel = asText(row.ctaLabel, MAX_CTA_LABEL);
    const ctaUrlResult = asUrl(row.ctaUrl);

    const type = asType(row.type);
    if (type === undefined) {
      rejections.push({ index, reason: `unknown type ${JSON.stringify(row.type)}` });
      return;
    }

    const placement = asPlacement(row.placement);
    if (placement === undefined) {
      rejections.push({ index, reason: `unknown placement ${JSON.stringify(row.placement)}` });
      return;
    }

    const zone = asZone(row.zone, placement);
    if (zone === undefined) {
      rejections.push({ index, reason: `unknown zone ${JSON.stringify(row.zone)}` });
      return;
    }

    const slot = Number.isFinite(Number(row.slot)) ? Number(row.slot) : 0;
    const animation = asAnimation(row.animation);
    if (animation === undefined) {
      rejections.push({ index, reason: `unknown animation ${JSON.stringify(row.animation)}` });
      return;
    }

    const bgColor = asColor(row.bgColor);
    const textColor = asColor(row.textColor);

    const startsAt = asIsoDate(row.startsAt);
    if (startsAt === undefined) {
      rejections.push({ index, reason: "startsAt is not a valid date" });
      return;
    }
    const endsAt = asIsoDate(row.endsAt);
    if (endsAt === undefined) {
      rejections.push({ index, reason: "endsAt is not a valid date" });
      return;
    }
    if (startsAt && endsAt && endsAt <= startsAt) {
      rejections.push({ index, reason: "endsAt must be after startsAt" });
      return;
    }

    const sortOrder = Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : index;

    // Empty banner: no title, no subtitle, no image → rejected with its index.
    if (!title && !subtitle && !imageUrlResult.url) {
      rejections.push({ index, reason: "empty banner needs a title, subtitle, or image" });
      return;
    }

    if (imageUrlResult.invalid) {
      rejections.push({ index, reason: "imageUrl is not a valid URL" });
      return;
    }
    if (ctaUrlResult.invalid) {
      rejections.push({ index, reason: "ctaUrl is not a valid URL" });
      return;
    }

    items.push({
      id: asText(row.id, MAX_ID) || fallbackId(`${title}|${subtitle}|${imageUrlResult.url}|${index}`),
      type,
      zone,
      placement,
      slot,
      title,
      subtitle,
      imageUrl: imageUrlResult.url,
      ctaLabel,
      ctaUrl: ctaUrlResult.url,
      active: row.active !== false,
      sortOrder,
      startsAt,
      endsAt,
      animation,
      bgColor,
      textColor,
    });
  });

  items.sort((a, b) => (a.sortOrder === b.sortOrder ? a.id.localeCompare(b.id) : a.sortOrder - b.sortOrder));
  return { items: items.slice(0, BANNER_MAX_ITEMS), rejections };
}

function asType(value: unknown): BannerType | undefined {
  return BANNER_TYPES.includes(value as BannerType) ? (value as BannerType) : undefined;
}

function asPlacement(value: unknown): BannerPlacement | undefined {
  return BANNER_PLACEMENTS.includes(value as BannerPlacement) ? (value as BannerPlacement) : undefined;
}

function asZone(value: unknown, placement: BannerPlacement): BannerZone | undefined {
  if (value === undefined || value === null || value === "") {
    return zoneForPlacement(placement);
  }
  const v = value as BannerZone;
  if (!BANNER_ZONES.includes(v)) return undefined;
  if (v !== zoneForPlacement(placement)) return undefined;
  return v;
}

function asAnimation(value: unknown): BannerAnimation | undefined {
  if (value === undefined || value === null || value === "") return "none";
  return BANNER_ANIMATIONS.includes(value as BannerAnimation) ? (value as BannerAnimation) : undefined;
}

function asColor(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  // Accept any CSS color the frontend sends — hex, rgb(), hsl(), named colors.
  return raw.slice(0, 64);
}

/** Public visibility: active AND inside the schedule window (if any). */
export function isBannerVisible(banner: Pick<Banner, "active" | "startsAt" | "endsAt">, now: Date): boolean {
  if (!banner.active) return false;
  if (banner.startsAt && now < new Date(banner.startsAt)) return false;
  if (banner.endsAt && now > new Date(banner.endsAt)) return false;
  return true;
}
