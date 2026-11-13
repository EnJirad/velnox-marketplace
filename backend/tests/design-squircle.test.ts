/**
 * Squircle shape system — the design contract behind VELNOX_DESIGN_THEME.md §7.1.
 *
 * Velnox uses one shape family: rounded SQUARES ("neither a circle nor a
 * square"), never pills and never hard corners. These are source assertions on
 * the token file and on the primitives every app shares, because a radius is
 * the one design decision that silently drifts: each screen re-types a class,
 * nothing breaks, and six months later the app has four different corner
 * languages again.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const CSS = "packages/shared/src/index.css";
const BUTTON = "packages/shared/src/components/ui/button.tsx";
const BADGE = "packages/shared/src/components/ui/badge.tsx";
const INPUT = "packages/shared/src/components/ui/input.tsx";
const CARD = "packages/shared/src/components/ui/card.tsx";
const SEGMENTED = "packages/shared/src/components/ui/segmented.tsx";
const AVATAR = "packages/shared/src/components/ui/avatar.tsx";
const GALLERY = "packages/shared/src/components/shop/ProductGallery.tsx";
const LIGHTBOX = "packages/shared/src/components/shop/GalleryLightbox.tsx";
const SHOP_HEADER = "apps/velshop/src/components/shop/ShopHeader.tsx";
const CATEGORY_STRIP = "apps/velshop/src/components/shop/CategoryStrip.tsx";
const THEME_DOC = "VELNOX_DESIGN_THEME.md";

describe("squircle tokens — one scale, declared once", () => {
  test("the four steps exist in @theme with their documented values", () => {
    const css = read(CSS);
    expect(css).toContain("--radius-squircle-xs: 0.4375rem;"); // 7px
    expect(css).toContain("--radius-squircle-sm: 0.625rem;"); // 10px
    expect(css).toContain("--radius-squircle: 0.875rem;"); // 14px
    expect(css).toContain("--radius-squircle-lg: 1.125rem;"); // 18px
  });

  test("the tokens live inside the Tailwind theme block, not a stray rule", () => {
    const css = read(CSS);
    const themeStart = css.indexOf("@theme inline {");
    const themeEnd = css.indexOf("\n}", themeStart);
    const block = css.slice(themeStart, themeEnd);
    expect(themeStart).toBeGreaterThan(-1);
    expect(block).toContain("--radius-squircle:");
    // An @theme token is what generates the `rounded-squircle*` utility; a
    // plain :root custom property would not.
    expect(block).toContain("--radius-squircle-lg:");
  });
});

describe("primitives — every shared control speaks squircle", () => {
  test("Button: default, small and large steps", () => {
    const src = read(BUTTON);
    expect(src).toContain("whitespace-nowrap rounded-squircle text-sm");
    expect(src).toContain('sm: "h-10 rounded-squircle-sm');
    expect(src).toContain('lg: "h-12 rounded-squircle-lg');
    // Icon sizes inherit the base radius, so an icon button is a squircle too.
    expect(src).toContain('icon: "size-11 sm:size-9"');
  });

  test("Badge is a squircle chip, not a pill", () => {
    const src = read(BADGE);
    expect(src).toContain("rounded-squircle-xs border px-2 py-0.5");
    expect(src).not.toContain("rounded-full");
  });

  test("Input and Card use the documented steps", () => {
    expect(read(INPUT)).toContain("rounded-squircle border bg-transparent");
    expect(read(CARD)).toContain("rounded-squircle-lg border");
  });

  test("SegmentedOption recipes are squircles", () => {
    const src = read(SEGMENTED);
    expect(src).toContain("rounded-squircle-sm transition-colors");
    expect(src).toContain("shrink-0 rounded-squircle px-4 py-2");
    // No recipe may fall back to a pill (the doc comment above the recipes is
    // allowed to mention the class it forbids).
    const recipes = src.slice(src.indexOf("const RECIPES"), src.indexOf("export interface SegmentedOptionProps"));
    expect(recipes).not.toContain("rounded-full");
  });

  test("no migrated primitive hard-codes a radius", () => {
    for (const file of [BUTTON, BADGE, INPUT, CARD, SEGMENTED]) {
      expect(read(file)).not.toMatch(/rounded-\[\d+px\]/);
    }
  });
});

describe("circles stay circles", () => {
  test("Avatar keeps rounded-full — it is a real circle, not a control", () => {
    const src = read(AVATAR);
    expect(src).toContain("overflow-hidden rounded-full");
    expect(src).not.toContain("rounded-squircle");
  });
});

describe("signature surfaces — gallery, lightbox, shop chrome", () => {
  test("gallery frame and thumbnail rail share one squircle token", () => {
    const src = read(GALLERY);
    const main = src.indexOf("relative min-w-0 flex-1 overflow-hidden rounded-squircle-lg");
    const rail = src.indexOf("relative shrink-0 self-stretch overflow-hidden rounded-squircle-lg");
    expect(main).toBeGreaterThan(-1);
    expect(rail).toBeGreaterThan(main);
  });

  test("the lightbox toolbar plate is a squircle with a centred icon", () => {
    const src = read(LIGHTBOX);
    // Without flex the inline SVG sits on the text baseline and rides high
    // inside its own plate — the bug this system exists to prevent.
    expect(src).toContain("flex size-10 items-center justify-center rounded-squircle");
    expect(src).toContain("border border-white/10 bg-white/10 text-white");
  });

  test("shop header controls and category chips are squircles", () => {
    expect(read(SHOP_HEADER)).toContain("rounded-squircle bg-white pl-4 pr-10");
    expect(read(SHOP_HEADER)).toContain("flex size-10 items-center justify-center rounded-squircle");
    expect(read(CATEGORY_STRIP)).toContain("rounded-squircle-sm px-3 py-1.5");
  });
});

describe("the theme document is the source of truth", () => {
  test("VELNOX_DESIGN_THEME.md documents the scale and the circle exception", () => {
    const doc = read(THEME_DOC);
    expect(doc).toContain("## 7.1 Squircle");
    expect(doc).toContain("`rounded-squircle-xs`");
    expect(doc).toContain("`rounded-squircle-lg`");
    // The exception list must exist, otherwise "squircle everywhere" turns
    // avatars and progress bars into squares.
    expect(doc).toContain("status dot");
    expect(doc).toContain("switch thumb");
    // The checklist carries it forward to the next UI change.
    expect(doc).toContain("Control ใหม่ทุกตัวเป็น squircle");
  });

  test("the frontend context file points at v2.2", () => {
    expect(read(".ai/context/frontend.md")).toContain("squircle");
  });
});
