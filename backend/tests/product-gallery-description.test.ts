/**
 * Product gallery + rich description — the contracts that make Seller, Backend and
 * VelShop one system rather than three copies of an idea.
 *
 * These are source/structure assertions plus pure-function checks; the DB-gated
 * end-to-end run lives in the product/gallery integration suites.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_DESCRIPTION_BLOCKS,
  isDisplayableImageUrl,
  parseDescriptionBlocks,
  validateDescriptionBlocks,
} from "../lib/description-blocks.js";

const root = join(import.meta.dir, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const GALLERY = "packages/shared/src/components/shop/ProductGallery.tsx";
const DESCRIPTION_EDITOR = "packages/shared/src/components/shop/ProductDescriptionEditor.tsx";
const SHOP_DETAIL = "apps/velshop/src/pages/ShopProductDetail.tsx";
const SELLER_FORM = "packages/shared/src/components/seller/ProductFormDialog.tsx";
const PRODUCT_ROUTES = "backend/routes/products.ts";
const SCHEMA = "db/schema.sql";
const RECONCILER = "db/run-sqleditor.sql";

describe("gallery layout — main image left, thumbnails right, one divider", () => {
  test("the divider is a real element between the two halves", () => {
    const src = read(GALLERY);
    // A vertical rule centred in its own gutter: equal distance from the main
    // image and the thumbnail column, and never a border that vanishes with a
    // rounded corner.
    expect(src).toContain('className="mx-2.5 w-px shrink-0 self-stretch bg-slate-200"');
    // …and only when there is something to divide (two or more images).
    expect(src).toMatch(/hasMoreThanOne && \(\s*<span aria-hidden/);
  });

  test("main image is left, thumbnails are a VERTICAL column on the right", () => {
    const src = read(GALLERY);
    const main = src.indexOf('className="relative min-w-0 flex-1 overflow-hidden rounded-squircle-lg');
    const divider = src.indexOf("self-stretch bg-slate-200");
    // The rail is a stretched flex item whose scrolling list is absolutely
    // positioned inside it, so a long list can never make the gallery taller.
    const thumbs = src.indexOf("relative shrink-0 self-stretch overflow-hidden");
    expect(main).toBeGreaterThan(-1);
    expect(divider).toBeGreaterThan(main);
    expect(thumbs).toBeGreaterThan(divider);
    expect(src).toContain("absolute inset-0 flex flex-col");
    // Uniform thumbnails: one size for every tile, never the image's own ratio.
    expect(src).toContain("style={{ width: thumbSize, height: thumbSize }}");
  });

  test("the thumbnail rail carries the same squircle corner as the main frame", () => {
    const src = read(GALLERY);
    // Same shape token as the main image box, so the clipped top/bottom edge of
    // the scrolling strip follows the frame's corner instead of a hard square cut.
    expect(src).toContain("relative shrink-0 self-stretch overflow-hidden rounded-squircle-lg");
    expect(src).toContain("className=\"relative min-w-0 flex-1 overflow-hidden rounded-squircle-lg");
  });

  test("the selected thumbnail carries the accent border", () => {
    const src = read(GALLERY);
    expect(src).toContain("border-brand ring-1 ring-brand/20");
  });

  test("swipe, prev/next, counter, zoom and loading/error states exist", () => {
    const src = read(GALLERY);
    expect(src).toContain("onTouchStart");
    expect(src).toContain("onTouchEnd");
    expect(src).toContain("labels.prev");
    expect(src).toContain("labels.next");
    // "1 / 6"
    expect(src).toContain("{safeIndex + 1} / {count}");
    expect(src).toContain("onOpenZoom");
    // A reserved 1:1 box means a slow image cannot shift the page.
    expect(src).toContain('aspectRatio: "1 / 1"');
    expect(src).toContain("Loader2");
    expect(src).toContain("ImageOff");
  });

  test("no image at all is a stated empty state, not a broken box", () => {
    const src = read(GALLERY);
    expect(src).toContain("if (count === 0)");
    expect(src).toContain("labels.noImage");
  });
});

describe("VelShop uses the shared gallery and keeps detail images out of it", () => {
  test("the page renders the shared component", () => {
    const src = read(SHOP_DETAIL);
    expect(src).toContain("<ProductGallery");
    expect(src).toContain("@velnox/shared/components/shop/ProductGallery");
  });

  test("detail images are NOT gallery entries", () => {
    const src = read(SHOP_DETAIL);
    // The gallery list is built from product images + the selected variant only.
    const galleryBlock = src.slice(src.indexOf("const allRaw"), src.indexOf("const detailImages"));
    expect(galleryBlock).not.toContain("group: 2");
    expect(galleryBlock).not.toContain("detailImagesByProduct");
    // …and the detail images are rendered in the description instead.
    const detailRender = src.slice(src.indexOf("const detailImages"), src.indexOf("const optionValueImageMap"));
    expect(detailRender).toContain("sortOrder");
    expect(src).toContain("detailImages.length > 0");
  });

  test("the rich description renders before the plain-text fallback", () => {
    const src = read(SHOP_DETAIL);
    expect(src).toContain("<ProductDescriptionContent");
    expect(src.indexOf("<ProductDescriptionContent")).toBeLessThan(
      src.indexOf("<ExpandableDescription"),
    );
  });
});

describe("seller editor — order and primary image are the same thing", () => {
  test("dragging reorders the array, and index 0 is the primary image", () => {
    const src = read(SELLER_FORM);
    expect(src).toContain("onDragStart");
    expect(src).toContain("onDrop");
    expect(src).toContain("const moveGalleryImage = (from: number, to: number)");
    // "Make primary" moves the tile to the front, which is what the backend
    // persists as sort_order 0 — no second notion of primary.
    expect(src).toContain("onClick={() => moveGalleryImage(i, 0)}");
    expect(src).toContain("const isPrimary = i === 0;");
  });

  test("the seller previews the REAL shop gallery, not a mock-up", () => {
    const src = read(SELLER_FORM);
    expect(src).toContain("<ProductGallery");
    expect(src).toContain("images={galleryImages.map");
  });

  test("reopening a product restores its blocks", () => {
    const src = read(SELLER_FORM);
    expect(src).toContain("descriptionBlocks");
    expect(src).toContain("setBlocks(");
  });
});

describe("description blocks — one shape, validated once", () => {
  test("accepts the five documented block types", () => {
    const parsed = validateDescriptionBlocks([
      { id: "a", type: "heading", text: "สเปก" },
      { id: "b", type: "text", text: "รายละเอียด" },
      { id: "c", type: "image", imageUrl: "https://cdn.example.com/a.webp" },
      { id: "d", type: "image_caption", text: "ด้านหน้า", imageUrl: "https://cdn.example.com/b.webp" },
      { id: "e", type: "image_text", text: "วัสดุ", imageUrl: "https://cdn.example.com/c.webp" },
    ]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.blocks).toHaveLength(5);
  });

  test("rejects what the shop could not render", () => {
    expect(validateDescriptionBlocks("nope").ok).toBe(false);
    expect(validateDescriptionBlocks([{ id: "a", type: "video", text: "x" }]).ok).toBe(false);
    expect(validateDescriptionBlocks([{ id: "a", type: "heading", text: "   " }]).ok).toBe(false);
    expect(validateDescriptionBlocks([{ id: "a", type: "image", imageUrl: "javascript:alert(1)" }]).ok).toBe(false);
    expect(
      validateDescriptionBlocks([
        { id: "dup", type: "text", text: "a" },
        { id: "dup", type: "text", text: "b" },
      ]).ok,
    ).toBe(false);
  });

  test("refuses more blocks than a page can carry", () => {
    const many = Array.from({ length: MAX_DESCRIPTION_BLOCKS + 1 }, (_, i) => ({
      id: `b${i}`,
      type: "text" as const,
      text: "x",
    }));
    expect(validateDescriptionBlocks(many).ok).toBe(false);
  });

  test("a missing or empty value means 'no rich description', not an error", () => {
    expect(validateDescriptionBlocks(undefined)).toEqual({ ok: true, blocks: [] });
    expect(validateDescriptionBlocks(null)).toEqual({ ok: true, blocks: [] });
    expect(validateDescriptionBlocks([])).toEqual({ ok: true, blocks: [] });
    // A legacy row / hand-edited JSON must never blank the page.
    expect(parseDescriptionBlocks(null)).toEqual([]);
    expect(parseDescriptionBlocks("not json")).toEqual([]);
    expect(parseDescriptionBlocks('[{"id":"a","type":"text","text":"ok"}]')).toHaveLength(1);
  });

  test("only http(s) and protocol-relative URLs are displayable", () => {
    expect(isDisplayableImageUrl("https://cdn.example.com/a.webp")).toBe(true);
    expect(isDisplayableImageUrl("//cdn.example.com/a.webp")).toBe(true);
    expect(isDisplayableImageUrl("data:image/png;base64,AAA")).toBe(false);
    expect(isDisplayableImageUrl("javascript:alert(1)")).toBe(false);
    expect(isDisplayableImageUrl("")).toBe(false);
  });
});

describe("backend — persisted, ownership-checked, additive schema", () => {
  test("both canonical SQL files declare the column, and the reconciler adds it", () => {
    expect(read(SCHEMA)).toContain("description_blocks JSONB NOT NULL DEFAULT '[]'::jsonb");
    expect(read(RECONCILER)).toContain(
      "ALTER TABLE public.products ADD COLUMN IF NOT EXISTS description_blocks JSONB NOT NULL DEFAULT '[]'::jsonb;",
    );
  });

  test("the product routes validate blocks and expose them back", () => {
    const src = read(PRODUCT_ROUTES);
    expect(src).toContain("validateDescriptionBlocks");
    expect(src).toContain("INVALID_DESCRIPTION_BLOCKS");
    expect(src).toContain("parseDescriptionBlocks(row.description_blocks)");
    // Both write paths: atomic create-full and the ownership-checked PATCH.
    expect(src.split("description_blocks").length - 1).toBeGreaterThanOrEqual(3);
  });

  test("the seller update route still checks ownership before writing", () => {
    const src = read(PRODUCT_ROUTES);
    const patchStart = src.indexOf('app.patch("/api/seller/products/:productId"');
    const patchEnd = src.indexOf('app.patch("/api/seller/products/:productId/status"');
    const block = src.slice(patchStart, patchEnd);
    expect(patchStart).toBeGreaterThan(-1);
    expect(block).toContain("verifyProductOwnership(productId, seller.id)");
    expect(block).toContain("description_blocks");
  });

  test("block images are detail images, never gallery thumbnails", () => {
    const src = read(SELLER_FORM);
    // The block picker uploads into the `details` folder, which the save path
    // stores with image_type 'detail' — the type the gallery query excludes.
    expect(src).toContain('draftUpload(draftId, file, "details")');
    const routes = read(PRODUCT_ROUTES);
    expect(routes).toContain("AND image_type = 'gallery'");
  });

  test("the public API returns blocks in the seller's order", () => {
    const src = read(PRODUCT_ROUTES);
    expect(src).toContain("descriptionBlocks: parseDescriptionBlocks(");
    // Order is the array order: the parser keeps it, the renderer keeps it.
    const editor = read(DESCRIPTION_EDITOR);
    expect(editor).toContain("shown.map((block, i) =>");
  });
});

describe("i18n — no hard-coded language in the shared gallery", () => {
  test("every visible string in the gallery arrives as a label", () => {
    const src = read(GALLERY);
    // The component itself carries no Thai/English copy.
    expect(src).not.toMatch(/"[ก-๙]/);
    expect(src).toContain("labels.mainImageAlt");
    expect(src).toContain("labels.noImage");
  });
});
