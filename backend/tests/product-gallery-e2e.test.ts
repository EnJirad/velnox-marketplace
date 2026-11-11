/**
 * Product gallery + rich description — END TO END over the real routes.
 *
 * What this proves (and the source-level suite cannot): a seller's order,
 * primary image and description blocks survive the round trip through the real
 * HTTP routes and real PostgreSQL, and come back in the same order to the public
 * product API that VelShop renders.
 *
 * DB-gated: needs TEST_DATABASE_URL + JWT_SECRET, skips otherwise. CI runs it
 * against the disposable PostgreSQL service in .github/workflows/test.yml.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "http";
import type { AddressInfo } from "net";
import cookieParser from "cookie-parser";
import express from "express";
import jwt from "jsonwebtoken";
import { query } from "../db/index.js";
import { setupProductRoutes } from "../routes/products.js";
import { setupProductOptionRoutes } from "../routes/product-options.js";
import { purgeUsers } from "./helpers/purge.js";
import { hasTestDatabase } from "./helpers/test-db.js";

const hasDb = hasTestDatabase() && Boolean(process.env.JWT_SECRET);
const itDb = hasDb ? test : test.skip;

let server: Server | null = null;
let base = "";
let marker = "";
const createdUserIds: string[] = [];
const createdShopIds: string[] = [];
const createdProductIds: string[] = [];
let sellerA = { userId: "", email: "" };
let sellerB = { userId: "", email: "" };
let productId = "";
let categoryId = "";

const GALLERY = [
  "https://img.velnox.test/g1.webp",
  "https://img.velnox.test/g2.webp",
  "https://img.velnox.test/g3.webp",
];
const DETAIL = ["https://img.velnox.test/d1.webp", "https://img.velnox.test/d2.webp"];

beforeAll(async () => {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));
  setupProductRoutes(app);
  setupProductOptionRoutes(app);
  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  marker = `gallery-${crypto.randomUUID().slice(0, 8)}`;
});

afterAll(async () => {
  if (hasDb) {
    if (createdProductIds.length > 0) {
      await query("DELETE FROM product_variants WHERE product_id = ANY($1::uuid[])", [createdProductIds]);
      await query("DELETE FROM product_images WHERE product_id = ANY($1::uuid[])", [createdProductIds]);
      await query("DELETE FROM products WHERE id = ANY($1::uuid[])", [createdProductIds]);
    }
    if (createdShopIds.length > 0) await query("DELETE FROM shops WHERE id = ANY($1::uuid[])", [createdShopIds]);
    if (createdUserIds.length > 0) await purgeUsers(createdUserIds);
  }
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
});

async function seedSeller(label: string) {
  const email = `${marker}-${label}-${crypto.randomUUID().slice(0, 8)}@test.invalid`;
  const u = await query("INSERT INTO users (email, name, role) VALUES ($1, $2, 'customer') RETURNING id", [
    email,
    `Gallery Fixture ${label}`,
  ]);
  const userId = u.rows[0].id as string;
  createdUserIds.push(userId);
  const s = await query("INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id", [userId]);
  const shop = await query(
    `INSERT INTO shops (seller_id, name, slug, description, category,
       address_line1, district, city, postal_code, phone)
     VALUES ($1, $2, $3, 'gallery fixture', 'แฟชั่น', '99/1 ถนนทดสอบ',
       'เขตทดสอบ', 'กรุงเทพมหานคร', '10110', '0899999999') RETURNING id`,
    [s.rows[0].id, `Gallery Shop ${label} ${marker}`, `${marker}-shop-${label}`],
  );
  createdShopIds.push(shop.rows[0].id as string);
  return { userId, email };
}

function cookie(userId: string, email: string): string {
  return `velnox_session=${jwt.sign({ userId, email }, process.env.JWT_SECRET as string, { expiresIn: "5m" })}`;
}

async function call(method: string, path: string, who: { userId: string; email: string } | null, body?: unknown) {
  return fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(who ? { Cookie: cookie(who.userId, who.email) } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** What VelShop renders: the public product payload. */
async function publicProduct(id: string) {
  const res = await call("GET", `/api/products/${id}`, null);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data?: any };
  return body.data;
}

describe("product gallery + description, end to end", () => {
  itDb("setup: two sellers and a product created with images and blocks in one call", async () => {
    sellerA = await seedSeller("a");
    sellerB = await seedSeller("b");
    const cat = await query(
      "SELECT id FROM categories WHERE is_active = true AND parent_id IS NULL ORDER BY sort_order ASC LIMIT 1",
    );
    expect(cat.rows.length).toBeGreaterThan(0);
    categoryId = cat.rows[0].id as string;

    const res = await call("POST", "/api/seller/products/create-full", sellerA, {
      product: {
        name: `Gallery Probe ${marker}`,
        category: categoryId,
        price: 100,
        unit: "ชิ้น",
        description: "plain summary text",
        // The seller's order IS the gallery order; index 0 is the main image.
        descriptionBlocks: [
          { id: "b1", type: "heading", text: "จุดเด่น" },
          { id: "b2", type: "text", text: "คำอธิบาย" },
          { id: "b3", type: "image", imageUrl: DETAIL[0] },
        ],
      },
      previewImages: GALLERY.map((url) => ({ url, objectKey: url })),
      detailImages: DETAIL.map((url) => ({ url, objectKey: url })),
      optionGroups: [],
      variants: [],
      attributes: [],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data?: any };
    productId = body.data?.id ?? body.data?.product?.id ?? "";
    expect(productId).toBeTruthy();
    createdProductIds.push(productId);
    // A freshly created product is a draft; the storefront only serves published
    // ones. Publishing here keeps the rest of the suite pointed at the PUBLIC
    // payload — the thing VelShop actually renders.
    await query("UPDATE products SET status = 'published' WHERE id = $1", [productId]);
  });

  itDb("the gallery order and the primary image survive the round trip", async () => {
    const product = await publicProduct(productId);
    expect(product.images).toHaveLength(3);
    expect(product.images.map((i: any) => i.url)).toEqual(GALLERY);
    expect(product.images.map((i: any) => i.sortOrder)).toEqual([0, 1, 2]);
    // Index 0 is the primary — the image the shop shows first.
    expect(product.images[0].isPrimary).toBe(true);
    expect(product.images[1].isPrimary).toBe(false);
    expect(product.primaryImage.url).toBe(GALLERY[0]);
  });

  itDb("reordering the gallery changes the main image for the shop, not just the seller", async () => {
    // Read the ids as the seller's own list gives them (sort_order 0,1,2).
    const rows = await query(
      "SELECT id, url FROM product_images WHERE product_id = $1 AND image_type = 'gallery' ORDER BY sort_order ASC",
      [productId],
    );
    const ids = rows.rows.map((r: any) => r.id as string);
    // Promote the third image: the seller's "ตั้งเป็นหลัก".
    const reordered = [ids[2], ids[0], ids[1]];
    const res = await call("PATCH", `/api/seller/products/${productId}/reorder-images`, sellerA, {
      orderedIds: reordered,
    });
    expect(res.status).toBe(200);

    const product = await publicProduct(productId);
    expect(product.images.map((i: any) => i.url)).toEqual([GALLERY[2], GALLERY[0], GALLERY[1]]);
    expect(product.images[0].isPrimary).toBe(true);
  });

  itDb("detail images never appear as gallery thumbnails", async () => {
    const product = await publicProduct(productId);
    const galleryUrls = product.images.map((i: any) => i.url);
    for (const detail of DETAIL) expect(galleryUrls).not.toContain(detail);
    // …and they are still served, separately, for the description.
    expect(product.detailImages.map((i: any) => i.url)).toEqual(DETAIL);
  });

  itDb("description blocks come back in the seller's order", async () => {
    const product = await publicProduct(productId);
    expect(product.descriptionBlocks.map((b: any) => b.type)).toEqual(["heading", "text", "image"]);
    expect(product.descriptionBlocks[0].text).toBe("จุดเด่น");
    expect(product.descriptionBlocks[2].imageUrl).toBe(DETAIL[0]);
  });

  itDb("saving a new order persists it (and reopening shows it)", async () => {
    const blocks = [
      { id: "x1", type: "text", text: "ย่อหน้าแรก" },
      { id: "x2", type: "image_caption", imageUrl: DETAIL[1], text: "คำบรรยาย" },
    ];
    const res = await call("PATCH", `/api/seller/products/${productId}`, sellerA, { descriptionBlocks: blocks });
    expect(res.status).toBe(200);

    const product = await publicProduct(productId);
    expect(product.descriptionBlocks).toEqual([
      { id: "x1", type: "text", text: "ย่อหน้าแรก" },
      { id: "x2", type: "image_caption", imageUrl: DETAIL[1], text: "คำบรรยาย" },
    ]);

    // The seller's OWN list carries them too, which is what the editor reopens.
    const list = await call("GET", "/api/seller/products", sellerA);
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { data?: any[] };
    const mine = (listBody.data ?? []).find((p: any) => p.id === productId);
    expect(mine?.descriptionBlocks).toHaveLength(2);
  });

  itDb("a malformed block is refused with 400 and changes nothing", async () => {
    const before = (await publicProduct(productId)).descriptionBlocks;
    const res = await call("PATCH", `/api/seller/products/${productId}`, sellerA, {
      descriptionBlocks: [{ id: "bad", type: "image", imageUrl: "javascript:alert(1)" }],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("INVALID_DESCRIPTION_BLOCKS");
    // Nothing was written.
    expect((await publicProduct(productId)).descriptionBlocks).toEqual(before);
  });

  itDb("another seller cannot change this product's blocks", async () => {
    const res = await call("PATCH", `/api/seller/products/${productId}`, sellerB, {
      descriptionBlocks: [{ id: "hijack", type: "text", text: "not mine" }],
    });
    expect([403, 404]).toContain(res.status);
    const product = await publicProduct(productId);
    expect(product.descriptionBlocks.some((b: any) => b.id === "hijack")).toBe(false);
  });

  itDb("an empty array clears the rich description but keeps the images", async () => {
    const res = await call("PATCH", `/api/seller/products/${productId}`, sellerA, { descriptionBlocks: [] });
    expect(res.status).toBe(200);
    const product = await publicProduct(productId);
    expect(product.descriptionBlocks).toEqual([]);
    expect(product.images).toHaveLength(3);
    expect(product.detailImages).toHaveLength(2);
  });
});
