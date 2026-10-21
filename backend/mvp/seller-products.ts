/**
 * MVP seller product management.
 *
 * Authorization: every route here is behind `requireApprovedSeller` (the seller
 * must own an APPROVED `seller_profiles` row) and every query is additionally
 * scoped by `products.seller_id = <own profile id>`. A product id from another
 * seller is a 404, exactly like a nonexistent one — ownership is never inferred
 * from the URL.
 *
 * Lifecycle: the transitions themselves belong to `db/mvp/schema.sql`
 * (`enforce_product_status_transition`). This module only exposes the actions a
 * seller may take (`submit`, `publish`) and the one policy the database cannot
 * express — a MATERIAL edit to a published listing takes it back to `draft` so
 * the reviewed artifact is never silently replaced (see `product-rules.ts`).
 *
 * `submitted` and `approved` are read-only for the seller: the schema's
 * transition set has no `submitted → draft` or `approved → draft` edge, so
 * "withdraw" is not a capability the MVP has. Editing is allowed in `draft`,
 * `rejected` and `published`.
 */
import type { Express, Request, Response } from "express";
import type pg from "pg";
import { query, withTransaction } from "../db/index.js";
import { writeMvpAudit } from "./audit.js";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  ok,
  pathUuid,
  queryOne,
  requireApprovedSeller,
  requireInt,
  requireMoney,
  requireString,
  optionalString,
  route,
  type SellerProfile,
} from "./http.js";
import { setStockLevel } from "./inventory.js";
import { generateProductSlug } from "./product-rules.js";

type Client = pg.PoolClient;

export interface ProductRow {
  id: string;
  seller_id: string;
  category_slug: string | null;
  name: string;
  slug: string;
  description: string;
  price: string;
  status: string;
  rejection_reason: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

const EDITABLE_STATUSES = new Set(["draft", "rejected", "published"]);

function sellerOf(req: Request): SellerProfile {
  const seller = req.mvpSeller;
  if (!seller) throw forbidden("SELLER_NOT_APPROVED", "This action requires an approved seller account");
  return seller;
}

export function parseImages(value: unknown): Array<{ url: string; alt: string }> {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw badRequest("INVALID_INPUT", "images must be an array");
  if (value.length > 10) throw badRequest("INVALID_INPUT", "A product may have at most 10 images");
  return value.map((entry, index) => {
    if (typeof entry === "string") {
      const url = entry.trim();
      if (!/^https?:\/\/\S+$/i.test(url) || url.length > 500) {
        throw badRequest("INVALID_IMAGE_URL", `images[${index}] must be an http(s) URL`);
      }
      return { url, alt: "" };
    }
    if (typeof entry !== "object" || entry === null) {
      throw badRequest("INVALID_INPUT", `images[${index}] must be a URL or { url, alt }`);
    }
    const raw = entry as Record<string, unknown>;
    const url = requireString(raw.url, `images[${index}].url`, { max: 500 });
    if (!/^https?:\/\/\S+$/i.test(url)) {
      throw badRequest("INVALID_IMAGE_URL", `images[${index}].url must be an http(s) URL`);
    }
    return { url, alt: optionalString(raw.alt, `images[${index}].alt`, { max: 200 }) ?? "" };
  });
}

interface VariantInput {
  name: string;
  sku: string | null;
  price: string;
  stock: number;
}

export function parseVariants(value: unknown): VariantInput[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw badRequest("INVALID_INPUT", "variants must be an array");
  if (value.length > 20) throw badRequest("INVALID_INPUT", "A product may have at most 20 variants");
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw badRequest("INVALID_INPUT", `variants[${index}] must be an object`);
    }
    const raw = entry as Record<string, unknown>;
    const name = requireString(raw.name, `variants[${index}].name`, { min: 1, max: 120 });
    if (seen.has(name.toLowerCase())) {
      throw badRequest("INVALID_INPUT", `variants[${index}].name is duplicated`);
    }
    seen.add(name.toLowerCase());
    return {
      name,
      sku: optionalString(raw.sku, `variants[${index}].sku`, { max: 64 }),
      price: requireMoney(raw.price, `variants[${index}].price`),
      stock:
        raw.stock === undefined || raw.stock === null
          ? 0
          : requireInt(raw.stock, `variants[${index}].stock`, { min: 0, max: 1_000_000 }),
    };
  });
}

async function assertCategoryExists(categorySlug: string | null): Promise<void> {
  if (!categorySlug) return;
  const row = await queryOne<{ slug: string }>(`SELECT slug FROM categories WHERE slug = $1`, [
    categorySlug,
  ]);
  if (!row) throw badRequest("CATEGORY_NOT_FOUND", "The selected category does not exist");
}

/** Load a product the caller OWNS. Another seller's product is a 404. */
export async function loadOwnedProduct(
  client: Client,
  productId: string,
  sellerId: string,
  opts: { forUpdate?: boolean } = {},
): Promise<ProductRow> {
  const result = await client.query(
    `SELECT id, seller_id, category_slug, name, slug, description, price, status,
            rejection_reason, submitted_at, approved_at, published_at, created_at, updated_at
       FROM products
      WHERE id = $1 AND seller_id = $2
      ${opts.forUpdate ? "FOR UPDATE" : ""}`,
    [productId, sellerId],
  );
  const row = result.rows[0] as ProductRow | undefined;
  if (!row) throw notFound("PRODUCT_NOT_FOUND", "Product not found");
  return row;
}

export async function sellerProductPayload(product: ProductRow): Promise<Record<string, unknown>> {
  const images = await query(
    `SELECT id, url, alt, sort_order FROM product_images
      WHERE product_id = $1 ORDER BY sort_order, created_at`,
    [product.id],
  );
  const variants = await query(
    `SELECT v.id, v.name, v.sku, v.price, v.status, v.sort_order,
            COALESCE(i.quantity, 0) AS quantity,
            COALESCE(i.reserved, 0) AS reserved
       FROM product_variants v
       LEFT JOIN inventory i ON i.product_id = v.product_id AND i.variant_id = v.id
      WHERE v.product_id = $1
      ORDER BY v.sort_order, v.created_at`,
    [product.id],
  );
  const baseStock = await queryOne<{ quantity: number; reserved: number }>(
    `SELECT quantity, reserved FROM inventory WHERE product_id = $1 AND variant_id IS NULL`,
    [product.id],
  );
  // Selling units are what the buyer chooses between (single / 3-pack / 6-pack).
  // They carry no stock of their own — `baseQuantity` is how much of the scope's
  // inventory one of them consumes. Inactive units are listed so the seller can
  // reactivate them, and they are never purchasable.
  const sellingUnits = await query(
    `SELECT id, variant_id, label, base_quantity, price, is_active, sort_order
       FROM product_selling_units
      WHERE product_id = $1
      ORDER BY sort_order, base_quantity, created_at`,
    [product.id],
  );

  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    price: product.price,
    categorySlug: product.category_slug,
    status: product.status,
    rejectionReason: product.rejection_reason,
    submittedAt: product.submitted_at,
    approvedAt: product.approved_at,
    publishedAt: product.published_at,
    createdAt: product.created_at,
    updatedAt: product.updated_at,
    images: (images.rows as Array<{ id: string; url: string; alt: string; sort_order: number }>).map(
      (row) => ({ id: row.id, url: row.url, alt: row.alt, sortOrder: row.sort_order }),
    ),
    variants: (
      variants.rows as Array<{
        id: string;
        name: string;
        sku: string | null;
        price: string;
        status: string;
        sort_order: number;
        quantity: number;
        reserved: number;
      }>
    ).map((row) => ({
      id: row.id,
      name: row.name,
      sku: row.sku,
      price: row.price,
      status: row.status,
      sortOrder: row.sort_order,
      stock: {
        quantity: Number(row.quantity),
        reserved: Number(row.reserved),
        available: Number(row.quantity) - Number(row.reserved),
      },
    })),
    stock: baseStock
      ? {
          quantity: Number(baseStock.quantity),
          reserved: Number(baseStock.reserved),
          available: Number(baseStock.quantity) - Number(baseStock.reserved),
        }
      : null,
    sellingUnits: (
      sellingUnits.rows as Array<{
        id: string;
        variant_id: string | null;
        label: string;
        base_quantity: number;
        price: string;
        is_active: boolean;
        sort_order: number;
      }>
    ).map((row) => ({
      id: row.id,
      variantId: row.variant_id,
      label: row.label,
      baseQuantity: Number(row.base_quantity),
      price: row.price,
      isActive: row.is_active,
      sortOrder: Number(row.sort_order),
    })),
  };
}

/**
 * Take a published listing out of the catalogue after a material edit.
 *
 * `published → draft` is one of the trigger's legal edges, so this is the
 * schema's own answer to "an approval must not survive a material change".
 */
async function demotePublishedIfMaterial(
  client: Client,
  product: ProductRow,
  material: boolean,
): Promise<void> {
  if (!material || product.status !== "published") return;
  await client.query(
    `UPDATE products SET status = 'draft', updated_at = NOW()
      WHERE id = $1 AND status = 'published'`,
    [product.id],
  );
  await writeMvpAudit(client, null, "PRODUCT_REOPENED_FOR_REVIEW", "product", product.id, {
    reason: "material_change_after_publish",
  });
}

function assertEditable(product: ProductRow): void {
  if (!EDITABLE_STATUSES.has(product.status)) {
    throw conflict(
      "PRODUCT_LOCKED",
      `A product in '${product.status}' cannot be edited; the lifecycle has no withdrawal step`,
    );
  }
}

export function setupMvpSellerProductRoutes(app: Express): void {
  const guard = [requireApprovedSeller];

  // ── Create a draft ───────────────────────────────────────────────────────
  app.post(
    "/api/mvp/seller/products",
    ...guard,
    route(async (req: Request, res: Response) => {
      const seller = sellerOf(req);
      const body = (req.body ?? {}) as Record<string, unknown>;

      const name = requireString(body.name, "name", { min: 2, max: 200 });
      const description = optionalString(body.description, "description", { max: 10_000 }) ?? "";
      const price = requireMoney(body.price, "price");
      const categorySlug = optionalString(body.categorySlug, "categorySlug", { max: 120 });
      const images = parseImages(body.images);
      const variants = parseVariants(body.variants);
      if (variants.length > 0 && body.stock !== undefined && body.stock !== null) {
        throw badRequest(
          "INVALID_INPUT",
          "stock belongs to a variant when the product has variants; omit the product-level stock",
        );
      }
      const baseStock =
        body.stock === undefined || body.stock === null
          ? 0
          : requireInt(body.stock, "stock", { min: 0, max: 1_000_000 });

      await assertCategoryExists(categorySlug);

      const created = await withTransaction(async (client) => {
        const product = await client.query(
          `INSERT INTO products (seller_id, category_slug, name, slug, description, price, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'draft')
           RETURNING id, seller_id, category_slug, name, slug, description, price, status,
                     rejection_reason, submitted_at, approved_at, published_at, created_at, updated_at`,
          [seller.id, categorySlug, name, generateProductSlug(name), description, price],
        );
        const row = product.rows[0] as ProductRow;

        for (const [index, image] of images.entries()) {
          await client.query(
            `INSERT INTO product_images (product_id, url, alt, sort_order) VALUES ($1, $2, $3, $4)`,
            [row.id, image.url, image.alt, index],
          );
        }

        if (variants.length === 0) {
          await client.query(
            `INSERT INTO inventory (product_id, variant_id, quantity) VALUES ($1, NULL, $2)`,
            [row.id, baseStock],
          );
        } else {
          for (const [index, variant] of variants.entries()) {
            const inserted = await client.query(
              `INSERT INTO product_variants (product_id, name, sku, price, sort_order)
               VALUES ($1, $2, $3, $4, $5)
               RETURNING id`,
              [row.id, variant.name, variant.sku, variant.price, index],
            );
            const variantId = (inserted.rows[0] as { id: string }).id;
            await client.query(
              `INSERT INTO inventory (product_id, variant_id, quantity) VALUES ($1, $2, $3)`,
              [row.id, variantId, variant.stock],
            );
          }
        }

        return row;
      });

      ok(res, { product: await sellerProductPayload(created) }, 201);
    }),
  );

  // ── Own product list ─────────────────────────────────────────────────────
  app.get(
    "/api/mvp/seller/products",
    ...guard,
    route(async (req: Request, res: Response) => {
      const seller = sellerOf(req);
      const params: unknown[] = [seller.id];
      let statusFilter = "";
      if (typeof req.query.status === "string" && req.query.status.trim()) {
        params.push(req.query.status.trim());
        statusFilter = ` AND status = $2`;
      }
      const result = await query(
        `SELECT id, seller_id, category_slug, name, slug, description, price, status,
                rejection_reason, submitted_at, approved_at, published_at, created_at, updated_at
           FROM products
          WHERE seller_id = $1${statusFilter}
          ORDER BY created_at DESC`,
        params,
      );
      const products = [];
      for (const row of result.rows as ProductRow[]) {
        products.push(await sellerProductPayload(row));
      }
      ok(res, { products });
    }),
  );

  // ── Own product detail ───────────────────────────────────────────────────
  app.get(
    "/api/mvp/seller/products/:id",
    ...guard,
    route(async (req: Request, res: Response) => {
      const seller = sellerOf(req);
      const productId = pathUuid(req.params.id);
      const product = await queryOne<ProductRow>(
        `SELECT id, seller_id, category_slug, name, slug, description, price, status,
                rejection_reason, submitted_at, approved_at, published_at, created_at, updated_at
           FROM products WHERE id = $1 AND seller_id = $2`,
        [productId, seller.id],
      );
      if (!product) throw notFound("PRODUCT_NOT_FOUND", "Product not found");
      ok(res, { product: await sellerProductPayload(product) });
    }),
  );

  // ── Edit a product ───────────────────────────────────────────────────────
  app.patch(
    "/api/mvp/seller/products/:id",
    ...guard,
    route(async (req: Request, res: Response) => {
      const seller = sellerOf(req);
      const productId = pathUuid(req.params.id);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const imagesProvided = body.images !== undefined;
      const images = imagesProvided ? parseImages(body.images) : null;

      const updated = await withTransaction(async (client) => {
        const product = await loadOwnedProduct(client, productId, seller.id, { forUpdate: true });
        assertEditable(product);

        const sets: string[] = [];
        const params: unknown[] = [];
        let material = false;

        if (body.name !== undefined) {
          const name = requireString(body.name, "name", { min: 2, max: 200 });
          if (name !== product.name) {
            params.push(name);
            sets.push(`name = $${params.length}`);
            material = true;
          }
        }
        if (body.description !== undefined) {
          const description = optionalString(body.description, "description", { max: 10_000 }) ?? "";
          if (description !== product.description) {
            params.push(description);
            sets.push(`description = $${params.length}`);
            material = true;
          }
        }
        if (body.price !== undefined) {
          const price = requireMoney(body.price, "price");
          if (price !== product.price) {
            params.push(price);
            sets.push(`price = $${params.length}`);
            material = true;
          }
        }
        if (body.categorySlug !== undefined) {
          const categorySlug = optionalString(body.categorySlug, "categorySlug", { max: 120 });
          await assertCategoryExists(categorySlug);
          if (categorySlug !== product.category_slug) {
            params.push(categorySlug);
            sets.push(`category_slug = $${params.length}`);
            material = true;
          }
        }

        if (images) {
          const current = await client.query(
            `SELECT url, alt, sort_order FROM product_images WHERE product_id = $1 ORDER BY sort_order, created_at`,
            [productId],
          );
          const before = JSON.stringify(
            (current.rows as Array<{ url: string; alt: string; sort_order: number }>).map((row) => [
              row.url,
              row.alt,
              row.sort_order,
            ]),
          );
          const after = JSON.stringify(images.map((image, index) => [image.url, image.alt, index]));
          if (before !== after) {
            material = true;
            await client.query(`DELETE FROM product_images WHERE product_id = $1`, [productId]);
            for (const [index, image] of images.entries()) {
              await client.query(
                `INSERT INTO product_images (product_id, url, alt, sort_order) VALUES ($1, $2, $3, $4)`,
                [productId, image.url, image.alt, index],
              );
            }
          }
        }

        if (sets.length > 0) {
          params.push(productId, seller.id);
          await client.query(
            `UPDATE products SET ${sets.join(", ")}, updated_at = NOW()
              WHERE id = $${params.length - 1} AND seller_id = $${params.length}`,
            params,
          );
        }

        await demotePublishedIfMaterial(client, product, material);

        return loadOwnedProduct(client, productId, seller.id);
      });

      ok(res, { product: await sellerProductPayload(updated) });
    }),
  );

  // ── Submit for review ────────────────────────────────────────────────────
  app.post(
    "/api/mvp/seller/products/:id/submit",
    ...guard,
    route(async (req: Request, res: Response) => {
      const seller = sellerOf(req);
      const productId = pathUuid(req.params.id);
      const product = await withTransaction(async (client) => {
        const existing = await loadOwnedProduct(client, productId, seller.id, { forUpdate: true });
        if (existing.status !== "draft" && existing.status !== "rejected") {
          throw conflict("INVALID_STATUS", `A product in '${existing.status}' cannot be submitted`);
        }
        await client.query(
          `UPDATE products
              SET status = 'submitted', submitted_at = NOW(), rejection_reason = NULL, updated_at = NOW()
            WHERE id = $1 AND seller_id = $2`,
          [productId, seller.id],
        );
        await writeMvpAudit(client, null, "PRODUCT_SUBMITTED", "product", productId, {
          sellerId: seller.id,
        });
        return loadOwnedProduct(client, productId, seller.id);
      });
      ok(res, { product: await sellerProductPayload(product) });
    }),
  );

  // ── Publish an approved product ──────────────────────────────────────────
  app.post(
    "/api/mvp/seller/products/:id/publish",
    ...guard,
    route(async (req: Request, res: Response) => {
      const seller = sellerOf(req);
      const productId = pathUuid(req.params.id);
      const product = await withTransaction(async (client) => {
        const existing = await loadOwnedProduct(client, productId, seller.id, { forUpdate: true });
        if (existing.status !== "approved") {
          throw conflict("NOT_APPROVED", "Only an approved product can be published");
        }
        await client.query(
          `UPDATE products
              SET status = 'published', published_at = NOW(), updated_at = NOW()
            WHERE id = $1 AND seller_id = $2`,
          [productId, seller.id],
        );
        await writeMvpAudit(client, null, "PRODUCT_PUBLISHED", "product", productId, {
          sellerId: seller.id,
        });
        return loadOwnedProduct(client, productId, seller.id);
      });
      ok(res, { product: await sellerProductPayload(product) });
    }),
  );

  // ── Add a variant ────────────────────────────────────────────────────────
  app.post(
    "/api/mvp/seller/products/:id/variants",
    ...guard,
    route(async (req: Request, res: Response) => {
      const seller = sellerOf(req);
      const productId = pathUuid(req.params.id);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const name = requireString(body.name, "name", { min: 1, max: 120 });
      const sku = optionalString(body.sku, "sku", { max: 64 });
      const price = requireMoney(body.price, "price");
      const stock =
        body.stock === undefined || body.stock === null
          ? 0
          : requireInt(body.stock, "stock", { min: 0, max: 1_000_000 });

      await withTransaction(async (client) => {
        const product = await loadOwnedProduct(client, productId, seller.id, { forUpdate: true });
        assertEditable(product);
        const count = await client.query(
          `SELECT COUNT(*)::int AS n FROM product_variants WHERE product_id = $1`,
          [productId],
        );
        const sortOrder = (count.rows[0] as { n: number }).n;
        const inserted = await client.query(
          `INSERT INTO product_variants (product_id, name, sku, price, sort_order)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [productId, name, sku, price, sortOrder],
        );
        const variantId = (inserted.rows[0] as { id: string }).id;
        await client.query(
          `INSERT INTO inventory (product_id, variant_id, quantity) VALUES ($1, $2, $3)`,
          [productId, variantId, stock],
        );
        // A base-product stock row and variant stock cannot coexist meaningfully:
        // once variants exist, availability is per variant.
        await client.query(
          `DELETE FROM inventory WHERE product_id = $1 AND variant_id IS NULL`,
          [productId],
        );
        await demotePublishedIfMaterial(client, product, true);
      });

      const product = await queryOne<ProductRow>(
        `SELECT id, seller_id, category_slug, name, slug, description, price, status,
                rejection_reason, submitted_at, approved_at, published_at, created_at, updated_at
           FROM products WHERE id = $1 AND seller_id = $2`,
        [productId, seller.id],
      );
      ok(res, { product: await sellerProductPayload(product!) }, 201);
    }),
  );

  // ── Edit a variant ───────────────────────────────────────────────────────
  app.patch(
    "/api/mvp/seller/products/:id/variants/:variantId",
    ...guard,
    route(async (req: Request, res: Response) => {
      const seller = sellerOf(req);
      const productId = pathUuid(req.params.id);
      const variantId = pathUuid(req.params.variantId, "variantId");
      const body = (req.body ?? {}) as Record<string, unknown>;

      await withTransaction(async (client) => {
        const product = await loadOwnedProduct(client, productId, seller.id, { forUpdate: true });
        assertEditable(product);
        const existing = await client.query(
          `SELECT id, name, sku, price, status FROM product_variants
            WHERE id = $1 AND product_id = $2 FOR UPDATE`,
          [variantId, productId],
        );
        const variant = existing.rows[0] as
          | { id: string; name: string; sku: string | null; price: string; status: string }
          | undefined;
        if (!variant) throw notFound("VARIANT_NOT_FOUND", "Variant not found");

        const sets: string[] = [];
        const params: unknown[] = [];
        let material = false;

        if (body.name !== undefined) {
          const name = requireString(body.name, "name", { min: 1, max: 120 });
          if (name !== variant.name) {
            params.push(name);
            sets.push(`name = $${params.length}`);
            material = true;
          }
        }
        if (body.sku !== undefined) {
          const sku = optionalString(body.sku, "sku", { max: 64 });
          if (sku !== variant.sku) {
            params.push(sku);
            sets.push(`sku = $${params.length}`);
            material = true;
          }
        }
        if (body.price !== undefined) {
          const price = requireMoney(body.price, "price");
          if (price !== variant.price) {
            params.push(price);
            sets.push(`price = $${params.length}`);
            material = true;
          }
        }
        if (body.status !== undefined) {
          const status = requireString(body.status, "status", { max: 20 });
          if (status !== "active" && status !== "inactive") {
            throw badRequest("INVALID_INPUT", "status must be 'active' or 'inactive'");
          }
          if (status !== variant.status) {
            params.push(status);
            sets.push(`status = $${params.length}`);
            material = true;
          }
        }

        if (sets.length > 0) {
          params.push(variantId, productId);
          await client.query(
            `UPDATE product_variants SET ${sets.join(", ")}, updated_at = NOW()
              WHERE id = $${params.length - 1} AND product_id = $${params.length}`,
            params,
          );
        }
        await demotePublishedIfMaterial(client, product, material);
      });

      const product = await queryOne<ProductRow>(
        `SELECT id, seller_id, category_slug, name, slug, description, price, status,
                rejection_reason, submitted_at, approved_at, published_at, created_at, updated_at
           FROM products WHERE id = $1 AND seller_id = $2`,
        [productId, seller.id],
      );
      ok(res, { product: await sellerProductPayload(product!) });
    }),
  );

  // ── Add a selling unit (set / pack) ──────────────────────────────────────
  // A selling unit NEVER creates stock. It says "this many base units for this
  // price"; checkout multiplies it against `inventory` for the same
  // (product, variant) scope. Editing it is a MATERIAL change to the listing
  // (price + what the buyer receives), so a published product returns to draft.
  app.post(
    "/api/mvp/seller/products/:id/selling-units",
    ...guard,
    route(async (req: Request, res: Response) => {
      const seller = sellerOf(req);
      const productId = pathUuid(req.params.id);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const label = requireString(body.label, "label", { min: 1, max: 80 });
      const baseQuantity = requireInt(body.baseQuantity, "baseQuantity", {
        min: 1,
        max: 1_000_000,
      });
      const price = requireMoney(body.price, "price");
      const variantId =
        body.variantId === undefined || body.variantId === null
          ? null
          : pathUuid(body.variantId, "variantId");
      if (body.isActive !== undefined && typeof body.isActive !== "boolean") {
        throw badRequest("INVALID_INPUT", "isActive must be a boolean");
      }
      const isActive = body.isActive === undefined ? true : body.isActive;

      await withTransaction(async (client) => {
        const product = await loadOwnedProduct(client, productId, seller.id, { forUpdate: true });
        assertEditable(product);
        if (variantId) {
          const variant = await client.query(
            `SELECT id FROM product_variants WHERE id = $1 AND product_id = $2`,
            [variantId, productId],
          );
          if (variant.rowCount === 0) throw notFound("VARIANT_NOT_FOUND", "Variant not found");
        }
        const count = await client.query(
          `SELECT COUNT(*)::int AS n FROM product_selling_units WHERE product_id = $1`,
          [productId],
        );
        await client.query(
          `INSERT INTO product_selling_units
             (product_id, variant_id, label, base_quantity, price, is_active, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            productId,
            variantId,
            label,
            baseQuantity,
            price,
            isActive,
            (count.rows[0] as { n: number }).n,
          ],
        );
        await writeMvpAudit(client, null, "SELLING_UNIT_CREATED", "product", productId, {
          label,
          baseQuantity,
          price,
          variantId,
        });
        await demotePublishedIfMaterial(client, product, true);
      });

      const product = await queryOne<ProductRow>(
        `SELECT id, seller_id, category_slug, name, slug, description, price, status,
                rejection_reason, submitted_at, approved_at, published_at, created_at, updated_at
           FROM products WHERE id = $1 AND seller_id = $2`,
        [productId, seller.id],
      );
      ok(res, { product: await sellerProductPayload(product!) }, 201);
    }),
  );

  // ── Edit / activate / deactivate a selling unit ──────────────────────────
  // No DELETE route: an order snapshots the unit, and a sold unit must stay
  // readable. Retire it with `isActive: false` instead.
  app.patch(
    "/api/mvp/seller/products/:id/selling-units/:unitId",
    ...guard,
    route(async (req: Request, res: Response) => {
      const seller = sellerOf(req);
      const productId = pathUuid(req.params.id);
      const unitId = pathUuid(req.params.unitId, "unitId");
      const body = (req.body ?? {}) as Record<string, unknown>;

      await withTransaction(async (client) => {
        const product = await loadOwnedProduct(client, productId, seller.id, { forUpdate: true });
        assertEditable(product);
        const existing = await client.query(
          `SELECT id, variant_id, label, base_quantity, price, is_active
             FROM product_selling_units
            WHERE id = $1 AND product_id = $2
            FOR UPDATE`,
          [unitId, productId],
        );
        const unit = existing.rows[0] as
          | {
              id: string;
              variant_id: string | null;
              label: string;
              base_quantity: number;
              price: string;
              is_active: boolean;
            }
          | undefined;
        if (!unit) throw notFound("SELLING_UNIT_NOT_FOUND", "Selling unit not found");

        const sets: string[] = [];
        const params: unknown[] = [];
        let material = false;

        if (body.label !== undefined) {
          const label = requireString(body.label, "label", { min: 1, max: 80 });
          if (label !== unit.label) {
            params.push(label);
            sets.push(`label = $${params.length}`);
            material = true;
          }
        }
        if (body.baseQuantity !== undefined) {
          const baseQuantity = requireInt(body.baseQuantity, "baseQuantity", {
            min: 1,
            max: 1_000_000,
          });
          if (baseQuantity !== Number(unit.base_quantity)) {
            params.push(baseQuantity);
            sets.push(`base_quantity = $${params.length}`);
            material = true;
          }
        }
        if (body.price !== undefined) {
          const price = requireMoney(body.price, "price");
          if (price !== unit.price) {
            params.push(price);
            sets.push(`price = $${params.length}`);
            material = true;
          }
        }
        if (body.isActive !== undefined) {
          if (typeof body.isActive !== "boolean") {
            throw badRequest("INVALID_INPUT", "isActive must be a boolean");
          }
          if (body.isActive !== unit.is_active) {
            params.push(body.isActive);
            sets.push(`is_active = $${params.length}`);
            // Retiring an option is operational, like stock — the reviewed
            // listing (label, size, price) does not change and a retired unit
            // can never be bought. Adding or re-pricing a unit IS material.
          }
        }

        if (sets.length > 0) {
          params.push(unitId, productId);
          await client.query(
            `UPDATE product_selling_units SET ${sets.join(", ")}, updated_at = NOW()
              WHERE id = $${params.length - 1} AND product_id = $${params.length}`,
            params,
          );
          await writeMvpAudit(client, null, "SELLING_UNIT_UPDATED", "product", productId, {
            sellingUnitId: unitId,
            label: typeof body.label === "string" ? body.label : unit.label,
            isActive: typeof body.isActive === "boolean" ? body.isActive : unit.is_active,
          });
        }
        await demotePublishedIfMaterial(client, product, material);
      });

      const product = await queryOne<ProductRow>(
        `SELECT id, seller_id, category_slug, name, slug, description, price, status,
                rejection_reason, submitted_at, approved_at, published_at, created_at, updated_at
           FROM products WHERE id = $1 AND seller_id = $2`,
        [productId, seller.id],
      );
      ok(res, { product: await sellerProductPayload(product!) });
    }),
  );

  // ── Set stock ────────────────────────────────────────────────────────────
  // Stock is operational, not a reviewed field: changing it never reopens
  // review, and it is refused below the reserved quantity.
  app.put(
    "/api/mvp/seller/products/:id/inventory",
    ...guard,
    route(async (req: Request, res: Response) => {
      const seller = sellerOf(req);
      const productId = pathUuid(req.params.id);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const variantId =
        body.variantId === undefined || body.variantId === null
          ? null
          : pathUuid(body.variantId, "variantId");
      const quantity = requireInt(body.quantity, "quantity", { min: 0, max: 1_000_000 });

      await withTransaction(async (client) => {
        await loadOwnedProduct(client, productId, seller.id);
        if (variantId) {
          const variant = await client.query(
            `SELECT id FROM product_variants WHERE id = $1 AND product_id = $2`,
            [variantId, productId],
          );
          if (variant.rowCount === 0) throw notFound("VARIANT_NOT_FOUND", "Variant not found");
        }
        await setStockLevel(client, productId, variantId, quantity);
      });

      const product = await queryOne<ProductRow>(
        `SELECT id, seller_id, category_slug, name, slug, description, price, status,
                rejection_reason, submitted_at, approved_at, published_at, created_at, updated_at
           FROM products WHERE id = $1 AND seller_id = $2`,
        [productId, seller.id],
      );
      ok(res, { product: await sellerProductPayload(product!) });
    }),
  );
}
