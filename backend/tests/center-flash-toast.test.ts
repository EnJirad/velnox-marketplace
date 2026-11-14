/**
 * One notification surface for VelShop.
 *
 * Before this change the product had two: a centred flash for "added to cart"
 * and sonner toasts in the top-left corner for everything else (wishlist,
 * address saved, review posted, every error). The same kind of message looked
 * like two different products.
 *
 * These tests pin the swap AND the shim's behaviour, because "it compiles" does
 * not prove a toast still reaches a surface.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { setFlashDispatcher, toast } from "../../packages/shared/src/lib/flash-toast.js";
import type { CenterFlashOptions } from "../../packages/shared/src/components/ui/center-flash.js";

const root = join(import.meta.dir, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/** Every .ts/.tsx file under a directory. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, dir))) {
    const rel = join(dir, entry);
    const abs = join(root, rel);
    if (statSync(abs).isDirectory()) out.push(...walk(rel));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(rel);
  }
  return out;
}

const received: CenterFlashOptions[] = [];

afterEach(() => {
  setFlashDispatcher(null);
  received.length = 0;
});

describe("the toast shim behaves like the toast it replaced", () => {
  test("success / error / warning / info all reach the flash", () => {
    setFlashDispatcher((options) => received.push(options));

    toast.success("เพิ่มรายการโปรดแล้ว");
    toast.error("ลบไม่สำเร็จ");
    toast.warning("สินค้าเหลือน้อย");
    toast.info("อัปเดตแล้ว");

    expect(received.map((r) => r.tone)).toEqual(["success", "error", "warning", "info"]);
    expect(received.map((r) => r.message)).toEqual([
      "เพิ่มรายการโปรดแล้ว",
      "ลบไม่สำเร็จ",
      "สินค้าเหลือน้อย",
      "อัปเดตแล้ว",
    ]);
  });

  test("a description and a custom duration are carried through", () => {
    setFlashDispatcher((options) => received.push(options));
    toast.success("เพิ่มลงตะกร้า", { description: "2 รายการ", duration: 2000 });
    expect(received[0].description).toBe("2 รายการ");
    expect(received[0].holdMs).toBe(2000);
  });

  test("sonner-only options are ignored instead of leaking into the render", () => {
    setFlashDispatcher((options) => received.push(options));
    // The old call sites pass position/className; they must not break anything.
    toast.success("ok", { position: "top-center", className: "bg-slate-900" });
    expect(received).toHaveLength(1);
    expect(received[0].description).toBeUndefined();
  });

  test("an empty message never flashes an empty box", () => {
    setFlashDispatcher((options) => received.push(options));
    toast.success("");
    toast.error("   ");
    toast.info(undefined);
    expect(received).toHaveLength(0);
  });

  test("without a host the calls are safe no-ops, not a crash", () => {
    setFlashDispatcher(null);
    expect(() => toast.success("nowhere to render")).not.toThrow();
  });

  test("dismiss/remove exist so old call sites keep working", () => {
    expect(() => toast.dismiss()).not.toThrow();
    expect(() => toast.remove()).not.toThrow();
  });
});

describe("VelShop uses exactly one notification surface", () => {
  test("no VelShop file imports sonner any more", () => {
    const offenders = walk("apps/velshop/src").filter((f) => read(f).includes('from "sonner"'));
    expect(offenders).toEqual([]);
  });

  test("every file that raises a toast imports the shared flash", () => {
    const raisers = walk("apps/velshop/src").filter((f) => /toast\.(success|error|warning|info|message)\(/.test(read(f)));
    expect(raisers.length).toBeGreaterThanOrEqual(17);
    const missing = raisers.filter((f) => !read(f).includes("@velnox/shared/lib/flash-toast"));
    expect(missing).toEqual([]);
  });

  test("the app mounts the flash host and no longer mounts the sonner Toaster", () => {
    const main = read("apps/velshop/src/main.tsx");
    expect(main).toContain("<CenterFlashHost />");
    expect(main).not.toContain("<Toaster />");
    expect(main).not.toContain("components/ui/sonner");
  });

  test("add-to-cart uses the same surface as everything else", () => {
    const detail = read("apps/velshop/src/pages/ShopProductDetail.tsx");
    const sheet = read("apps/velshop/src/components/shop/ProductSelectionSheet.tsx");
    for (const src of [detail, sheet]) {
      // No page-local flash instance may compete with the global one.
      expect(src).not.toContain("useCenterFlash");
      expect(src).not.toContain("centerFlashNode");
      expect(src).toContain("productDetail.addedFlash");
    }
  });

  test("the host is the only place that mounts a flash node", () => {
    const mounts = walk("apps/velshop/src").filter((f) => read(f).includes("<CenterFlashHost"));
    expect(mounts).toEqual([join("apps", "velshop", "src", "main.tsx")]);
  });
});

describe("all three apps use one notification surface", () => {
  test("no app or shared component imports sonner for toasts", () => {
    const offenders = [...walk("apps"), ...walk("packages/shared/src")].filter(
      (f) => !f.endsWith("ui/sonner.tsx") && read(f).includes('from "sonner"'),
    );
    expect(offenders).toEqual([]);
  });

  test("each app mounts the flash host and no sonner Toaster", () => {
    for (const app of ["velshop", "velseller", "velcenter"]) {
      const main = read(`apps/${app}/src/main.tsx`);
      expect(main).toContain("<CenterFlashHost />");
      expect(main).not.toContain("<Toaster />");
    }
  });
});

describe("the flash itself still has one message at a time", () => {
  test("the hook keeps a single slot and a real fade", () => {
    const src = read("packages/shared/src/components/ui/center-flash.tsx");
    expect(src).toContain("setState({ id: Date.now(), options, totalMs, reduced })");
    expect(src).toContain("velnox-center-flash");
    expect(src).toContain('role="status"');
    expect(src).toContain("pointer-events-none");
  });

  test("four tones are defined, matching the four kinds of message", () => {
    const src = read("packages/shared/src/components/ui/center-flash.tsx");
    expect(src).toContain('"success" | "error" | "warning" | "info"');
  });
});
