/**
 * Marketing + VelCenter responsive — static surface contracts (T7 of
 * MARKETING-RESPONSIVE-01). The live write path needs Neon + R2 credentials and
 * mutates production content, so this file pins the wiring that IS verifiable
 * statically; the pure banner rules have their own unit suite (banners.test.ts).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const centerSrc = read("apps/velcenter/src/pages/Center.tsx");
const editorSrc = read("apps/velcenter/src/components/MarketingBanners.tsx");
const carouselSrc = read("apps/velshop/src/components/shop/AnnouncementCarousel.tsx");
const homeSrc = read("apps/velshop/src/pages/ShopHome.tsx");
const stripSrc = read("apps/velshop/src/components/shop/HomePromoStrip.tsx");
const routesSrc = read("backend/routes/announcements.ts");
const libSrc = read("backend/lib/banners.ts");

describe("Marketing is a dedicated VelCenter section, not a Settings child (VC-06/07)", () => {
  test("the marketing tab exists and is gated by the same policy as settings", () => {
    expect(centerSrc).toContain('case "settings":\n    case "marketing":');
    expect(centerSrc).toContain('<TabsTrigger value="marketing"');
    // The trigger sits BEFORE the settings trigger in the nav order.
    expect(centerSrc.indexOf('value="marketing"')).toBeLessThan(centerSrc.indexOf('value="settings"'));
  });

  test("MarketingBanners renders in its own TabsContent, not inside Settings", () => {
    expect(centerSrc).toContain("<MarketingBanners />");
    // No AnnouncementSettings import/usage survives.
    expect(centerSrc).not.toContain("AnnouncementSettings");
    const marketingBlock = centerSrc.slice(centerSrc.indexOf('value="marketing"'));
    expect(marketingBlock.indexOf("<MarketingBanners />")).toBeGreaterThan(-1);
    // The settings TabsContent opens AFTER the marketing block.
    const settingsIdx = centerSrc.indexOf('<TabsContent value="settings"');
    const marketingIdx = centerSrc.indexOf('<TabsContent value="marketing"');
    expect(marketingIdx).toBeLessThan(settingsIdx);
  });

  test("the old Settings-embedded component file is gone", () => {
    let missing = false;
    try {
      read("apps/velcenter/src/components/AnnouncementSettings.tsx");
    } catch {
      missing = true;
    }
    expect(missing).toBe(true);
  });
});

describe("Banner editor contract (BAN-01..BAN-12)", () => {
  test("uploads go through the existing R2 presign flow with purpose=announcement (BAN-05)", () => {
    expect(editorSrc).toContain("/upload/presign");
    expect(editorSrc).toContain("purpose: \"announcement\"");
    expect(editorSrc).toContain("/upload/confirm");
    expect(editorSrc).not.toMatch(/placeholder\.com|via\.placeholder|placehold\.co|picsum\.photos/);
  });

  test("the empty-banner rule is enforced client-side before save (BAN-04)", () => {
    expect(editorSrc).toContain("!row.title.trim() && !row.subtitle.trim() && !row.imageUrl");
    expect(editorSrc).toContain("marketing.emptyBannerError");
  });

  test("all three modes are editable; image is explicitly optional (BAN-01/02/03)", () => {
    expect(editorSrc).toContain("marketing.fieldTitleHint");
    expect(editorSrc).toContain("marketing.uploadHint");
    expect(editorSrc).toContain('type: "promotion"');
    expect(editorSrc).toContain('"home_strip"');
    expect(editorSrc).toContain('"home_hero"');
  });

  test("reorder + enable + delete are wired (BAN-06/07)", () => {
    expect(editorSrc).toContain("marketing.up");
    expect(editorSrc).toContain("marketing.down");
    expect(editorSrc).toContain("active: event.target.checked");
    expect(editorSrc).toContain("prev.filter");
  });

  test("backend rejections surface with their index, not a generic toast", () => {
    expect(editorSrc).toContain("marketing.rejectPrefix");
    expect(editorSrc).toMatch(/\/\^banner \(\\d\+\): \(\.\+\)\$\//);
  });
});

describe("Storefront rendering (BAN-02/03/09/10, BAN-08)", () => {
  test("the carousel renders image-only slides WITHOUT a text column", () => {
    expect(carouselSrc).toContain("const hasText = Boolean(item.title || item.subtitle || item.eyebrow)");
    expect(carouselSrc).toContain("hasText ? \"w-[32%] shrink-0 sm:w-[38%]\" : \"w-full\"");
  });

  test("CTA label comes from the banner, storefront label is only the fallback", () => {
    expect(carouselSrc).toContain('item.ctaLabel || t("home.bannerCta")');
  });

  test("ShopHome drops empty banners and omits the eyebrow for image-only slides", () => {
    expect(homeSrc).toContain('if (!title && !subtitle && !imageUrl) return null;');
    expect(homeSrc).toContain('eyebrow: title || subtitle ? t(typeKey) : ""');
    // v1 field names no longer feed the storefront mapping.
    expect(homeSrc).not.toContain("row.description");
    expect(homeSrc).not.toContain("row.linkUrl");
  });

  test("the promo strip (HomePromoStrip) removed in simplified home design — only Hero carousel + Category Strip + Featured Rail + Product Grid remain", () => {
    // Simplified design: Hero (AnnouncementCarousel) + CategoryStrip + HorizontalRail + Product Grid
    // HomePromoStrip no longer rendered on homepage
    expect(homeSrc).not.toContain('<HomePromoStrip');
    expect(homeSrc).not.toContain('stripBanners');
    // Hero carousel still filters to home_hero
    expect(homeSrc).toContain('(row.placement ?? "home_hero") === "home_hero"');
    // CategoryStrip still present
    expect(homeSrc).toContain('<CategoryStrip');
    // Single Featured Rail present
    expect(homeSrc).toContain('<HorizontalRail');
    // Product Grid present
    expect(homeSrc).toContain('grid grid-cols-2');
    expect(stripSrc).not.toMatch(/placeholder\.com|picsum\.photos/);
  });

  test("hero carousel filters to home_hero (strip banners do not leak into it)", () => {
    expect(homeSrc).toContain('(row.placement ?? "home_hero") === "home_hero"');
  });
});

describe("Backend announcements contract (BAN-04, VC-08, authorization)", () => {
  test("PUT validates and answers 400 with the offending index instead of silently dropping", () => {
    expect(routesSrc).toContain("normaliseBanners");
    expect(routesSrc).toContain("message: `banner ${firstRejection.index}: ${firstRejection.reason}`");
    expect(routesSrc).not.toContain(".filter(() => false)"); // no silent-drop leftovers
  });

  test("admin routes still require settings.manage (VC-08, never frontend-only)", () => {
    expect(routesSrc.match(/userHasPermission\(userId, "settings\.manage"\)/g)?.length).toBe(2);
  });

  test("public visibility applies active + schedule (BAN-06/08)", () => {
    expect(routesSrc).toContain("isBannerVisible(item, now)");
    expect(libSrc).toContain("export function isBannerVisible");
  });

  test("no new table, no schema change — the v1 key is kept (BAN-12)", () => {
    // The exact platform_settings key — renaming it would orphan previously
    // published banners (this exact regression was caught in QA r1).
    expect(routesSrc).toContain('SETTINGS_KEY = "shop_announcements"');
    expect(read("backend/lib/banners.ts")).toContain("description");
    expect(read("backend/lib/banners.ts")).toContain("linkUrl");
  });
});

describe("Settings responsive fix (VC-01..VC-05)", () => {
  test("the section nav no longer scrolls sideways on mobile — it wraps in a grid", () => {
    const settingsNav = centerSrc.slice(centerSrc.indexOf('aria-label="หมวดการตั้งค่า"'));
    expect(settingsNav.slice(0, 400)).toContain("grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:flex lg:flex-col");
    expect(settingsNav).not.toContain("overflow-x-auto");
    expect(settingsNav).not.toContain("whitespace-nowrap");
  });

  test("section buttons are 44px touch targets (VC-11 accessibility)", () => {
    const settingsNav = centerSrc.slice(centerSrc.indexOf('aria-label="หมวดการตั้งค่า"'));
    expect(settingsNav).toContain("min-h-11");
  });

  test("no NEW overflow-x:hidden is added anywhere as the fix", () => {
    // The shared shell CSS is the only home of overflow-x rules; the pre-existing
    // count (3, html/body/#root level) must not grow — a new "fix by hiding
    // overflow" would show up here.
    const css = read("packages/shared/src/index.css");
    const total = (css.match(/overflow-x:\s*hidden/g) ?? []).length;
    expect(total).toBe(3);
  });
});
