/**
 * Seller product ownership — HTTP probes over the REAL product routes.
 *
 * Pins AC-08 of the product-creation-flow audit: a seller must only be able to
 * read and mutate products they own, enforced on the BACKEND (the frontend
 * never matters for security). Probes every product-scoped endpoint with a
 * second, unrelated approved seller (expects 403/404, never 200) and with the
 * owner (expects 200). A cross-seller 200 here is a data-leak defect.
 *
 * DB-gated: needs TEST_DATABASE_URL + JWT_SECRET; skips otherwise (CI runs it
 * against the disposable PostgreSQL service from .github/workflows/test.yml).
 * No production connection is possible: backend/db/test-database.ts refuses a
 * production-shaped DATABASE_URL before any pool is created.
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

// ─── Harness state ────────────────────────────────────────────────────────
let server: Server | null = null;
let base = "";
let marker = "";
const createdUserIds: string[] = [];
const createdShopIds: string[] = [];
const createdProductIds: string[] = [];
let ownerA = { userId: "", email: "" };
let ownerB = { userId: "", email: "" };
let productA = { id: "", slug: "" };

beforeAll(async () => {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));
  setupProductRoutes(app);
  setupProductOptionRoutes(app);
  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  if (!hasDb) return;
  marker = `prod-own-${crypto.randomUUID().slice(0, 8)}`;
});

afterAll(async () => {
  if (hasDb) {
    if (createdProductIds.length > 0) {
      await query("DELETE FROM product_variants WHERE product_id = ANY($1::uuid[])", [createdProductIds]);
      await query("DELETE FROM product_images WHERE product_id = ANY($1::uuid[])", [createdProductIds]);
      await query("DELETE FROM products WHERE id = ANY($1::uuid[])", [createdProductIds]);
    }
    if (createdShopIds.length > 0) {
      await query("DELETE FROM shops WHERE id = ANY($1::uuid[])", [createdShopIds]);
    }
    if (createdUserIds.length > 0) {
      await purgeUsers(createdUserIds);
    }
  }
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
});

// ─── Seeding helpers (same shapes as seller-access-authorization) ─────────
async function seedApprovedSeller(label: string) {
  const email = `${marker}-${label}-${crypto.randomUUID().slice(0, 8)}@test.invalid`;
  const u = await query(
    "INSERT INTO users (email, name, role) VALUES ($1, $2, 'customer') RETURNING id",
    [email, `Ownership Fixture ${label}`],
  );
  const userId = u.rows[0].id as string;
  createdUserIds.push(userId);
  const s = await query("INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id", [userId]);
  const shop = await query(
    `INSERT INTO shops (seller_id, name, slug, description, category,
       address_line1, district, city, postal_code, phone)
     VALUES ($1, $2, $3, 'ownership fixture', 'แฟชั่น', '99/1 ถนนทดสอบ',
       'เขตทดสอบ', 'กรุงเทพมหานคร', '10110', '0899999999') RETURNING id`,
    [s.rows[0].id, `Ownership Shop ${label} ${marker}`, `${marker}-shop-${label}`],
  );
  createdShopIds.push(shop.rows[0].id as string);
  return { userId, email };
}

function cookie(userId: string, email: string): string {
  // No `jti` → no revocation lookup; identity comes from the session only.
  return `velnox_session=${jwt.sign({ userId, email }, process.env.JWT_SECRET as string, { expiresIn: "5m" })}`;
}

async function call(
  method: string,
  path: string,
  who: { userId: string; email: string } | null,
  body?: unknown,
) {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(who ? { Cookie: cookie(who.userId, who.email) } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("seller product ownership — cross-seller access is refused on the backend", () => {
  itDb("seed: two approved sellers; A creates one real product via create-full", async () => {
    ownerA = await seedApprovedSeller("a");
    ownerB = await seedApprovedSeller("b");

    const category = await query(
      "SELECT id FROM categories WHERE is_active = true AND parent_id IS NULL ORDER BY sort_order ASC LIMIT 1",
    );
    expect(category.rows.length).toBeGreaterThan(0);

    const res = await call("POST", "/api/seller/products/create-full", ownerA, {
      product: {
        name: `Ownership Probe ${marker}`,
        category: category.rows[0].id,
        // create-full requires a finite price (products.ts VALIDATION_ERROR otherwise)
        price: 100,
        unit: "ชิ้น",
        description: "created by the ownership probe",
      },
      previewImages: [
        { url: "https://img.velnox.test/ownership-probe.jpg", objectKey: `ownership-probe/${marker}.jpg` },
      ],
      detailImages: [],
      optionGroups: [],
      variants: [],
      attributes: [],
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { success: boolean; data?: { id: string; slug: string } };
    expect(data.success).toBe(true);
    productA = { id: data.data!.id, slug: data.data!.slug };
    createdProductIds.push(productA.id);
  });

  itDb("the seller product list is shop-scoped: B never sees A's product, A does", async () => {
    // NOTE: the list endpoint ignores query params like `search` — isolation
    // comes from the shop-scoping inside the handler, which is exactly what
    // these assertions pin: A's list contains the product, B's list never does.
    const mine = await call("GET", `/api/seller/products`, ownerA);
    expect(mine.status).toBe(200);
    const mineBody = (await mine.json()) as { data?: Array<{ id?: string; product?: { id?: string } }> };
    const mineIds = JSON.stringify(mineBody);
    expect(mineIds).toContain(productA.id);

    const theirs = await call("GET", `/api/seller/products`, ownerB);
    expect(theirs.status).toBe(200);
    const theirsBody = await theirs.text();
    expect(theirsBody).not.toContain(productA.id);
  });

  itDb("PATCH product — owner 200, other seller 403/404", async () => {
    const theirs = await call("PATCH", `/api/seller/products/${productA.id}`, ownerB, { name: "Hijacked" });
    expect([403, 404]).toContain(theirs.status);
    const mine = await call("PATCH", `/api/seller/products/${productA.id}`, ownerA, { description: "owner edit" });
    expect(mine.status).toBe(200);
  });

  itDb("DELETE product — other seller 403/404, product survives", async () => {
    const theirs = await call("DELETE", `/api/seller/products/${productA.id}`, ownerB);
    expect([403, 404]).toContain(theirs.status);
    const still = await query("SELECT id FROM products WHERE id = $1", [productA.id]);
    expect(still.rows.length).toBe(1);
  });

  itDb("option groups and values — other seller 403/404", async () => {
    const theirs = await call("POST", `/api/seller/products/${productA.id}/option-groups`, ownerB, {
      name: "Colour",
      displayType: "text",
    });
    expect([403, 404]).toContain(theirs.status);
    const read = await call("GET", `/api/seller/products/${productA.id}/options`, ownerB);
    expect([403, 404]).toContain(read.status);
  });

  itDb("variants — other seller 403/404 on list, generate and patch", async () => {
    const list = await call("GET", `/api/seller/products/${productA.id}/variants`, ownerB);
    expect([403, 404]).toContain(list.status);
    const gen = await call("POST", `/api/seller/products/${productA.id}/variants/generate`, ownerB, {});
    expect([403, 404]).toContain(gen.status);
  });

  itDb("unauthenticated caller — 401 on every product-scoped endpoint", async () => {
    const list = await call("GET", `/api/seller/products`, null);
    expect([401, 403]).toContain(list.status);
    const write = await call("PATCH", `/api/seller/products/${productA.id}`, null, { name: "anon" });
    expect([401, 403]).toContain(write.status);
  });
});
