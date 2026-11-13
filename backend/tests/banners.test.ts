/**
 * Banner contract v2 — pure unit tests for backend/lib/banners.ts.
 *
 * Pins the rules the VelCenter Marketing editor and the public storefront API
 * both depend on. No database, no HTTP: every case is a direct call.
 */
import { describe, expect, test } from "bun:test";
import {
  BANNER_MAX_ITEMS,
  isBannerVisible,
  normaliseBanners,
} from "../lib/banners.js";

const NOW = new Date("2026-11-02T10:00:00.000Z");

const base = {
  id: "a1",
  type: "announcement" as const,
  placement: "home_hero" as const,
  active: true,
  sortOrder: 0,
};

describe("normaliseBanners — the three content modes are all valid (BAN-02)", () => {
  test("image-only (no title, no subtitle) survives", () => {
    const { items, rejections } = normaliseBanners([
      { ...base, title: "", subtitle: "", imageUrl: "https://r2.example/img.webp" },
    ]);
    expect(rejections).toHaveLength(0);
    expect(items).toHaveLength(1);
    expect(items[0].imageUrl).toBe("https://r2.example/img.webp");
    expect(items[0].title).toBe("");
  });

  test("text-only (no image) survives", () => {
    const { items, rejections } = normaliseBanners([
      { ...base, title: "Big sale", subtitle: "Up to 30% off", imageUrl: null },
    ]);
    expect(rejections).toHaveLength(0);
    expect(items[0].title).toBe("Big sale");
    expect(items[0].imageUrl).toBeNull();
  });

  test("image + text survives", () => {
    const { items, rejections } = normaliseBanners([
      { ...base, title: "Summer", subtitle: "Sale", imageUrl: "https://r2.example/s.webp" },
    ]);
    expect(rejections).toHaveLength(0);
    expect(items).toHaveLength(1);
  });

  test("subtitle-only survives (text without title)", () => {
    const { items, rejections } = normaliseBanners([{ ...base, title: "", subtitle: "Hello" }]);
    expect(rejections).toHaveLength(0);
    expect(items[0].subtitle).toBe("Hello");
  });
});

describe("normaliseBanners — empty banners are rejected with their index (BAN-04)", () => {
  test("a completely empty item is rejected, valid siblings survive", () => {
    const { items, rejections } = normaliseBanners([
      { ...base, title: "keep", imageUrl: "https://r2.example/ok.webp" },
      { id: "a2", type: "announcement", placement: "home_hero", title: "", subtitle: "", imageUrl: null },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("a1");
    expect(rejections).toEqual([{ index: 1, reason: expect.stringContaining("empty") }]);
  });

  test("whitespace-only text is empty", () => {
    const { items, rejections } = normaliseBanners([{ ...base, title: "   ", subtitle: "" }]);
    expect(items).toHaveLength(0);
    expect(rejections).toHaveLength(1);
  });
});

describe("normaliseBanners — enums are explicit, never coerced", () => {
  test("unknown type rejected", () => {
    const { items, rejections } = normaliseBanners([
      { ...base, title: "x", type: "super_sale" },
    ]);
    expect(items).toHaveLength(0);
    expect(rejections[0].reason).toContain("unknown type");
  });

  test("unknown placement rejected", () => {
    const { items, rejections } = normaliseBanners([
      { ...base, title: "x", placement: "sidebar" },
    ]);
    expect(items).toHaveLength(0);
    expect(rejections[0].reason).toContain("unknown placement");
  });
});

describe("normaliseBanners — URL rules (BAN-08 CTA / VC-08)", () => {
  test("javascript: and data: destinations REJECT the banner with a clear reason", () => {
    for (const evil of ["javascript:alert(1)", "data:text/html,<b>x</b>", "ftp://x/y"]) {
      const { items, rejections } = normaliseBanners([
        { ...base, title: "x", ctaUrl: evil },
      ]);
      expect(items).toHaveLength(0);
      expect(rejections[0].reason).toContain("ctaUrl is not a valid URL");
    }
    // Same rule for the image URL.
    const { items: imgItems, rejections: imgRej } = normaliseBanners([
      { ...base, title: "x", imageUrl: "javascript:alert(1)" },
    ]);
    expect(imgItems).toHaveLength(0);
    expect(imgRej[0].reason).toContain("imageUrl is not a valid URL");
  });

  test("in-app paths and https URLs are kept", () => {
    const { items } = normaliseBanners([
      { ...base, title: "x", ctaUrl: "/products?sale=1", imageUrl: "https://r2.example/a.webp" },
    ]);
    expect(items[0].ctaUrl).toBe("/products?sale=1");
    expect(items[0].imageUrl).toBe("https://r2.example/a.webp");
  });
});

describe("normaliseBanners — scheduling (BAN-08)", () => {
  test("valid ISO dates are normalised to UTC ISO-8601", () => {
    const { items, rejections } = normaliseBanners([
      { ...base, title: "x", startsAt: "2026-11-01T00:00:00+07:00" },
    ]);
    expect(rejections).toHaveLength(0);
    expect(items[0].startsAt).toBe("2026-10-31T17:00:00.000Z");
    expect(items[0].endsAt).toBeNull();
  });

  test("invalid or inverted dates are rejected", () => {
    const bad = normaliseBanners([{ ...base, title: "x", startsAt: "not-a-date" }]);
    expect(bad.rejections[0].reason).toContain("startsAt");
    const inverted = normaliseBanners([
      { ...base, title: "x", startsAt: "2026-11-02T10:00:00Z", endsAt: "2026-11-01T10:00:00Z" },
    ]);
    expect(inverted.rejections[0].reason).toContain("endsAt must be after startsAt");
  });

  test("visibility boundaries: startsAt inclusive, endsAt inclusive, null = unbounded", () => {
    const b = { active: true, startsAt: "2026-11-02T10:00:00.000Z", endsAt: "2026-11-03T10:00:00.000Z" };
    expect(isBannerVisible(b, new Date("2026-11-01T10:00:00.000Z"))).toBe(false); // before
    expect(isBannerVisible(b, new Date("2026-11-02T10:00:00.000Z"))).toBe(true); // exactly at start
    expect(isBannerVisible(b, new Date("2026-11-03T10:00:00.000Z"))).toBe(true); // exactly at end
    expect(isBannerVisible(b, new Date("2026-11-03T10:00:00.001Z"))).toBe(false); // after
    expect(isBannerVisible({ active: true, startsAt: null, endsAt: null }, NOW)).toBe(true);
    expect(isBannerVisible({ active: false, startsAt: null, endsAt: null }, NOW)).toBe(false); // BAN-06
  });
});

describe("normaliseBanners — ordering (BAN-07)", () => {
  test("sorted ascending by sortOrder, ties broken by id", () => {
    const { items } = normaliseBanners([
      { ...base, id: "b", title: "second", sortOrder: 2 },
      { ...base, id: "a", title: "first", sortOrder: 1 },
      { ...base, id: "a2", title: "tie-a2", sortOrder: 1 },
    ]);
    expect(items.map((i) => i.id)).toEqual(["a", "a2", "b"]);
  });
});

describe("normaliseBanners — legacy v1 rows keep working (BAN-12)", () => {
  test("v1 shape maps description→subtitle, linkUrl→ctaUrl, defaults fill enums", () => {
    const { items, rejections } = normaliseBanners([
      { id: "v1", title: "Welcome", description: "Old row", linkUrl: "/products", active: true, sortOrder: 0 },
    ]);
    expect(rejections).toHaveLength(0);
    expect(items[0]).toMatchObject({
      id: "v1",
      subtitle: "Old row",
      ctaUrl: "/products",
      type: "announcement",
      placement: "home_hero",
      title: "Welcome",
    });
  });

  test("a v1 row without a title but with a description is now valid (was silently dropped in v1)", () => {
    const { items } = normaliseBanners([
      { id: "v1b", description: "text only row", active: true },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].subtitle).toBe("text only row");
  });
});

describe("normaliseBanners — cap and lengths", () => {
  test("cap at 10 items", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      ...base,
      id: `x${i}`,
      title: `t${i}`,
      sortOrder: i,
    }));
    const { items, rejections } = normaliseBanners(many);
    expect(items).toHaveLength(BANNER_MAX_ITEMS);
    expect(rejections).toHaveLength(0); // excess is truncated, not "invalid"
  });

  test("long text is truncated, not rejected", () => {
    const { items } = normaliseBanners([{ ...base, title: "t".repeat(500) }]);
    expect(items[0].title).toHaveLength(120);
  });

  describe("normaliseBanners — new product/store fields (BAN-13)", () => {
    test("product placement derives zone=product and slot defaults to 0", () => {
      const { items, rejections } = normaliseBanners([
        { ...base, placement: "product_below_price", title: "ผ่อน 0%", subtitle: "กับบัตรเครดิต" },
      ]);
      expect(rejections).toHaveLength(0);
      expect(items[0].zone).toBe("product");
      expect(items[0].slot).toBe(0);
    });

    test("store placement derives zone=store", () => {
      const { items, rejections } = normaliseBanners([
        { ...base, placement: "store_header", title: "โปรโมชั่นร้าน" },
      ]);
      expect(rejections).toHaveLength(0);
      expect(items[0].zone).toBe("store");
    });

    test("zone must match placement prefix", () => {
      const { rejections } = normaliseBanners([
        { ...base, placement: "product_below_price", zone: "store" },
      ]);
      expect(rejections).toHaveLength(1);
      expect(rejections[0].reason).toContain("unknown zone");
    });

    test("animation accepted and defaults to none", () => {
      const { items, rejections } = normaliseBanners([
        { ...base, placement: "product_above_gallery", title: "ส่งฟรี", animation: "fade" },
        { ...base, id: "x2", placement: "product_above_gallery", title: "ลดราคา" },
      ]);
      expect(rejections).toHaveLength(0);
      expect(items[0].animation).toBe("fade");
      expect(items[1].animation).toBe("none");
    });

    test("invalid animation is rejected", () => {
      const { rejections } = normaliseBanners([
        { ...base, placement: "product_above_gallery", title: "ส่งฟรี", animation: "spin" },
      ]);
      expect(rejections).toHaveLength(1);
      expect(rejections[0].reason).toContain("unknown animation");
    });

    test("bgColor and textColor are stored", () => {
      const { items, rejections } = normaliseBanners([
        { ...base, placement: "product_above_gallery", title: "ส่งฟรี", bgColor: "#ecfdf5", textColor: "#047857" },
      ]);
      expect(rejections).toHaveLength(0);
      expect(items[0].bgColor).toBe("#ecfdf5");
      expect(items[0].textColor).toBe("#047857");
    });

    test("all nine placements are accepted", () => {
      const placements: BannerPlacement[] = [
        "home_hero", "home_strip",
        "product_above_gallery", "product_below_image", "product_below_price", "product_above_tabs",
        "store_header", "store_above_products", "store_between_products",
      ];
      const { items, rejections } = normaliseBanners(
        placements.map((p, i) => ({ ...base, id: `p${i}`, placement: p, title: `t${i}`, sortOrder: i }))
      );
      expect(rejections).toHaveLength(0);
      expect(items).toHaveLength(9);
    });
  });
});
