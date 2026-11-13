/**
 * Add-to-cart UX — the two behaviours a customer judges the product page by:
 *
 *   1. The header must not leave a stray grey rule above/below it. VelShop's
 *      second sticky bar rendered white nav links on a white surface (invisible)
 *      and left only its `border-b` visible — a grey line with nothing in it.
 *   2. "Add to cart" must CLOSE the option sheet and confirm in the middle of
 *      the screen. Leaving the sheet open made a successful add look like a
 *      no-op, and a corner toast is easy to miss while looking at the sheet.
 *
 * These are source/structure assertions: the behaviour is UI state, and the
 * project has no DOM renderer for app pages.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const HEADER = "apps/velshop/src/components/shop/ShopHeader.tsx";
const DETAIL = "apps/velshop/src/pages/ShopProductDetail.tsx";
const SHEET = "apps/velshop/src/components/shop/ProductSelectionSheet.tsx";
const FLASH = "packages/shared/src/components/ui/center-flash.tsx";
const CSS = "packages/shared/src/index.css";

describe("shop header — no stray grey rule", () => {
  test("the dead second sticky bar is gone", () => {
    const src = read(HEADER);
    // That bar carried white nav links on `bg-white` (invisible) and a
    // `border-b border-slate-200` — the grey line customers asked about.
    expect(src).not.toContain("Category sticky bar");
    expect(src).not.toContain("top-[3.5rem]");
    expect(src).not.toContain("border-b border-slate-200 bg-white");
  });

  test("the header still has its mobile bar, desktop bar and cart drawer", () => {
    const src = read(HEADER);
    expect(src).toContain("bg-brand md:hidden");
    expect(src).toContain("hidden border-b border-white/15 bg-brand md:block");
    expect(src).toContain("<CartDrawer");
  });
});

describe("add to cart — closes the sheet, then confirms at the centre", () => {
  test("the direct-mode confirm closes the sheet on a cart action", () => {
    const src = read(DETAIL);
    const confirm = src.slice(src.indexOf("const handleSheetConfirm"));
    const cartBranch = confirm.slice(
      confirm.indexOf('if (pendingAction === "cart")'),
      confirm.indexOf('else if (pendingAction === "buy")'),
    );
    expect(cartBranch.length).toBeGreaterThan(0);
    // The bug: the cart branch added to the cart but never closed the sheet.
    expect(cartBranch).toContain("setVariantSheetOpen(false)");
    expect(cartBranch).toContain("setPendingAction(null)");
  });

  test("both cart paths use the centred flash instead of a corner toast", () => {
    const src = read(DETAIL);
    expect(src).toContain('import { useCenterFlash } from "@velnox/shared/components/ui/center-flash"');
    expect(src).toContain("const { flash: flashCenter, node: centerFlashNode } = useCenterFlash()");
    expect(src).toContain("flashCenter({");
    // The old dark corner toast for "added" is gone.
    expect(src).not.toContain('position: "top-center"');
    expect(src).not.toContain('t("productDetail.addedToast"');
    // The node is rendered by the page that owns the action.
    expect(src).toContain("{centerFlashNode}");
  });

  test("the shared selection sheet closes first, then flashes", () => {
    const src = read(SHEET);
    const addStart = src.indexOf("const handleAddToCart");
    const addEnd = src.indexOf("const handleBuyNow");
    const add = src.slice(addStart, addEnd);
    // Close before confirming — the message must outlive the sheet.
    expect(add).toContain("onOpenChange(false)");
    expect(add.indexOf("onOpenChange(false)")).toBeLessThan(add.indexOf("flashCenter("));
    // The message is mounted outside the Sheet, so closing it cannot unmount it.
    expect(src).toContain("{centerFlashNode}");
    expect(src).not.toContain('t("productDetail.addedToast"');
  });
});

describe("center-flash — one centred message, never blocking", () => {
  test("it is centred, non-blocking and announced", () => {
    const src = read(FLASH);
    expect(src).toContain('role="status"');
    expect(src).toContain('aria-live="polite"');
    expect(src).toContain("pointer-events-none");
    expect(src).toContain("fixed inset-0 z-[200] flex items-center justify-center");
  });

  test("one message at a time, and the fade is a real animation", () => {
    const src = read(FLASH);
    // A second call replaces the first instead of stacking.
    expect(src).toContain("setState({ id: Date.now(), options, totalMs, reduced })");
    expect(src).toContain("velnox-center-flash");
    expect(read(CSS)).toContain("@keyframes velnox-center-flash");
  });

  test("reduced motion still shows the message, just without the animation", () => {
    const src = read(FLASH);
    expect(src).toContain("prefers-reduced-motion: reduce");
    expect(src).toContain("animation: reduced ? undefined :");
  });
});

describe("i18n — the confirmation exists in all three languages", () => {
  const locales = {
    en: "packages/shared/src/lib/i18n/locales/en.ts",
    th: "packages/shared/src/lib/i18n/locales/th.ts",
    my: "packages/shared/src/lib/i18n/locales/my.ts",
  };

  for (const [name, path] of Object.entries(locales)) {
    test(`${name} carries addedFlash + addedFlashDesc with the same placeholder`, () => {
      const src = read(path);
      expect(src).toContain("addedFlash:");
      // Plain "{qty}" strings — t() only resolves string values, so a function
      // here would print the raw key on screen (this happened).
      expect(src).toContain("addedFlashDesc: \"");
      expect(src).toContain("{qty}");
    });
  }

  test("the Thai copy is the one the owner asked for", () => {
    expect(read(locales.th)).toContain('addedFlash: "เพิ่มลงตะกร้าสำเร็จ"');
  });
});
