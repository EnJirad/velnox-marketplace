/**
 * Deterministic coverage for the seller product editor's image state.
 *
 * These helpers decide what the editor shows for a stored product and what still
 * needs uploading on save — the two places where the "existing images disappear"
 * and "image uploaded twice" defects lived. No database and no browser needed.
 */
import { describe, expect, test } from "bun:test";
import {
  pendingUploads,
  seedGalleries,
  type ProductImageLike,
} from "../../packages/shared/src/lib/product-images";

const img = (over: Partial<ProductImageLike>): ProductImageLike => ({
  id: over.id ?? "id",
  url: over.url ?? "https://cdn.example/x.webp",
  imageType: over.imageType,
  alt: over.alt ?? "",
  storageKey: over.storageKey ?? null,
  sortOrder: over.sortOrder ?? 0,
});

describe("product image state — seeding the editor", () => {
  test("gallery and detail images are split by type", () => {
    const state = seedGalleries([
      img({ id: "a", imageType: "gallery" }),
      img({ id: "b", imageType: "detail" }),
      img({ id: "c", imageType: "gallery" }),
    ]);
    expect(state.gallery.map((i) => i.id)).toEqual(["a", "c"]);
    expect(state.detail.map((i) => i.id)).toEqual(["b"]);
  });

  test("an image with no type is treated as a gallery image", () => {
    const state = seedGalleries([img({ id: "legacy", imageType: null })]);
    expect(state.gallery).toHaveLength(1);
    expect(state.detail).toHaveLength(0);
  });

  test("order follows sort_order, then server order", () => {
    const state = seedGalleries([
      img({ id: "third", sortOrder: 2 }),
      img({ id: "first", sortOrder: 0 }),
      img({ id: "second", sortOrder: 1 }),
      img({ id: "tie", sortOrder: 1 }),
    ]);
    expect(state.gallery.map((i) => i.id)).toEqual(["first", "second", "tie", "third"]);
  });

  test("existing images keep their database id and storage key", () => {
    const state = seedGalleries([img({ id: "keep", storageKey: "products/x.webp", alt: "หน้า" })]);
    expect(state.gallery[0]).toEqual({
      id: "keep",
      url: "https://cdn.example/x.webp",
      alt: "หน้า",
      objectKey: "products/x.webp",
    });
  });

  test("null or malformed input yields empty galleries", () => {
    expect(seedGalleries(null)).toEqual({ gallery: [], detail: [] });
    expect(seedGalleries(undefined)).toEqual({ gallery: [], detail: [] });
    expect(seedGalleries([] as ProductImageLike[])).toEqual({ gallery: [], detail: [] });
  });
});

describe("product image state — what still needs uploading", () => {
  test("drafts with a url and no id are pending", () => {
    expect(pendingUploads([{ url: "https://cdn.example/new.webp" }])).toHaveLength(1);
  });

  test("stored images (with an id) are never re-uploaded", () => {
    expect(pendingUploads([{ id: "a", url: "https://cdn.example/a.webp" }])).toHaveLength(0);
  });

  test("an entry without a url is ignored", () => {
    expect(pendingUploads([{ url: "" }])).toHaveLength(0);
  });

  test("re-seeding after a save leaves nothing pending (no duplicates)", () => {
    const afterSave = seedGalleries([
      img({ id: "a", imageType: "gallery", sortOrder: 0 }),
      img({ id: "c", imageType: "gallery", sortOrder: 1 }),
    ]);
    expect(pendingUploads(afterSave.gallery)).toHaveLength(0);
    expect(afterSave.gallery.map((i) => i.id)).toEqual(["a", "c"]);
  });
});
