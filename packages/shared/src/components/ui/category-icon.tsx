/**
 * CategoryIcon — shared renderer for category icons.
 *
 * One component to render a category's icon no matter which app shows it
 * (VelCenter, VelShop, VelSeller). The stored value can be:
 *
 *   1. An image URL             → `<img>` (uploaded PNG/JPG/WEBP/SVG on R2)
 *   2. An Iconify namespaced id → lazy-loaded local SVG: "mdi:shopping",
 *                                 "tabler:device-laptop", "ph:house", …
 *   3. A legacy Lucide name     → real Lucide SVG resolved by name (curated
 *                                 set synchronously; unknown names resolve via
 *                                 the full local Lucide collection lazily)
 *   4. Anything else            → a graceful default fallback (never a broken/blank cell)
 *
 * It NEVER renders a raw name as text, never treats a URL as an icon name, and
 * never falls back to a hard-coded generic image. Invalid names degrade to the
 * passed/default fallback icon.
 *
 * The curated set below is bundled as tree-shakeable named imports (the
 * synchronous fast-path for every legacy value); Iconify names and unknown
 * names render through the on-demand local library (code-split per collection,
 * loaded lazily, cached — no runtime requests).
 */
import {
  Package,
  Archive,
  Boxes,
  Briefcase,
  Cake,
  Car,
  Cpu,
  Dumbbell,
  Footprints,
  Gamepad2,
  Gem,
  Gift,
  Globe,
  Headphones,
  Heart,
  Home,
  Shirt,
  ShoppingBag,
  ShoppingBasket,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Store,
  Wrench,
  BedDouble,
  Baby,
  BookOpen,
  Leaf,
  Sprout,
  Tag,
  Truck,
  Laptop,
  Monitor,
  Watch,
  Palette,
  UtensilsCrossed,
  Coffee,
  Salad,
  Beer,
  Wine,
  IceCreamCone,
  Cookie,
  CandlestickChart,
  Book,
  PenTool,
  Backpack,
  Tent,
  Bike,
  Plane,
  Ship,
  Anchor,
  MapPin,
  Camera,
  Film,
  Music,
  Mic,
  Tv,
  Gamepad,
  CupSoda,
  FlaskConical,
  Pill,
  Stethoscope,
  Dna,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@velnox/shared/lib/utils";
import { LibraryIcon } from "@velnox/shared/lib/icons";

/**
 * Curated Lucide icon set used by the category picker and this renderer.
 * kebab-case name → PascalCase icon. Every entry is a real, verified Lucide export.
 */
export const CATEGORY_ICON_SET: Record<string, LucideIcon> = {
  archive: Archive,
  box: Package,
  boxes: Boxes,
  briefcase: Briefcase,
  cake: Cake,
  car: Car,
  cpu: Cpu,
  dumbbell: Dumbbell,
  footprints: Footprints,
  "gamepad-2": Gamepad2,
  gem: Gem,
  gift: Gift,
  globe: Globe,
  headphones: Headphones,
  heart: Heart,
  home: Home,
  shirt: Shirt,
  "shopping-bag": ShoppingBag,
  "shopping-basket": ShoppingBasket,
  "shopping-cart": ShoppingCart,
  smartphone: Smartphone,
  sparkles: Sparkles,
  store: Store,
  tools: Wrench,
  bed: BedDouble,
  baby: Baby,
  "book-open": BookOpen,
  leaf: Leaf,
  sprout: Sprout,
  tag: Tag,
  truck: Truck,
  laptop: Laptop,
  monitor: Monitor,
  watch: Watch,
  palette: Palette,
  "utensils-crossed": UtensilsCrossed,
  coffee: Coffee,
  salad: Salad,
  beer: Beer,
  wine: Wine,
  "ice-cream": IceCreamCone,
  cookie: Cookie,
  "candlestick-chart": CandlestickChart,
  book: Book,
  "pen-tool": PenTool,
  backpack: Backpack,
  tent: Tent,
  bike: Bike,
  plane: Plane,
  ship: Ship,
  anchor: Anchor,
  "map-pin": MapPin,
  camera: Camera,
  film: Film,
  music: Music,
  mic: Mic,
  tv: Tv,
  gamepad: Gamepad,
  "cup-soda": CupSoda,
  "flask-conical": FlaskConical,
  pill: Pill,
  stethoscope: Stethoscope,
  dna: Dna,
};

/** Sorted list of available icon names (for the picker/search UI). */
export const CATEGORY_ICON_NAMES: string[] = Object.keys(CATEGORY_ICON_SET).sort();

/** kebab-case → PascalCase (e.g. "shopping-bag" → "ShoppingBag"). */
function kebabToPascal(name: string): string {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/**
 * Resolve a stored icon value to a Lucide component, or null when the value is
 * an image URL / not a known icon. Never throws.
 */
export function resolveCategoryIcon(value: string | null | undefined): LucideIcon | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Image URLs and data: URIs are images, not icon names.
  if (isUrl(trimmed)) return null;

  // Exact curated match (kebab-case key).
  const direct = CATEGORY_ICON_SET[trimmed.toLowerCase().replace(/\s+/g, "-")];
  if (direct) return direct;

  // Legacy PascalCase or "Icon" suffix forms stored by older versions.
  const pascal = kebabToPascal(trimmed);
  const asKebab = pascal.replace(/Icon$/, "").toLowerCase().replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()).replace(/^-/, "");
  const viaPascal = CATEGORY_ICON_SET[asKebab] ?? CATEGORY_ICON_SET[pascal.toLowerCase()];
  return viaPascal ?? null;
}

/** Is this value an image URL (http/https) or inline data URI? */
function isUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:");
}

/** First of the inputs that is a usable image URL. */
function firstUrl(...values: Array<string | null | undefined>): string | null {
  for (const v of values) {
    if (v && isUrl(v.trim())) return v.trim();
  }
  return null;
}

export interface CategoryIconProps {
  /** Stored icon value: image URL, data: URL, Iconify "prefix:name", or Lucide name. */
  icon?: string | null;
  /** Legacy/uploaded image URL (kept for backward compatibility). */
  imageUrl?: string | null;
  className?: string;
  /** Fallback icon when nothing resolves (default: Package). */
  fallback?: LucideIcon;
  /** Alt text for the image (default empty — decorative). */
  alt?: string;
}

/**
 * Unified renderer. Resolution order:
 *   1. imageUrl (legacy field) if it is a URL
 *   2. icon value if it is a URL / data: URI
 *   3. Iconify namespaced value ("prefix:name", e.g. "mdi:shopping") → lazy-loaded
 *      local SVG via LibraryIcon (offline, code-split per collection)
 *   4. icon value resolved against the curated Lucide set (synchronous fast-path,
 *      keeps every existing kebab-case / PascalCase / "Icon"-suffixed legacy name)
 *   5. any other bare name → full local Lucide collection (enhancement; invalid
 *      names degrade to the fallback)
 *   6. fallback / default icon
 */
export function CategoryIcon({ icon, imageUrl, className, fallback = Package, alt = "" }: CategoryIconProps) {
  const src = firstUrl(imageUrl, icon);
  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className={cn("object-cover", className)}
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
        }}
      />
    );
  }

  const value = (icon ?? "").trim();
  const renderFallback = () => {
    const FallbackIcon = fallback ?? Package;
    return <FallbackIcon aria-hidden={alt === ""} className={className} strokeWidth={2} />;
  };

  if (value) {
    // Namespaced Iconify identifier → full local library (lazy, offline).
    if (value.includes(":")) {
      return <LibraryIcon icon={value} className={className} title={alt || undefined} fallback={renderFallback} />;
    }

    // Curated Lucide fast-path — preserves all legacy kebab/Pascal names exactly.
    const IconComp = resolveCategoryIcon(value);
    if (IconComp) {
      return <IconComp aria-hidden={alt === ""} className={className} strokeWidth={2} />;
    }

    // Bare name not in the curated set → try the full local Lucide collection.
    return <LibraryIcon icon={value} className={className} title={alt || undefined} fallback={renderFallback} />;
  }

  return renderFallback();
}
