/**
 * Velnox Product Routes — Complete Seller Product Management & Public Catalog
 *
 * Seller endpoints (requireAuth + seller ownership):
 *   GET    /api/seller/products                      — List seller's products
 *   POST   /api/seller/products                      — Create product
 *   PATCH  /api/seller/products/:productId            — Update product
 *   DELETE /api/seller/products/:productId            — Delete product + images
 *   PATCH  /api/seller/products/:productId/status     — Set product status
 *   PATCH  /api/seller/products/:productId/stock      — Set inventory quantity
 *   PATCH  /api/seller/products/:productId/reorder-level — Set reorder level
 *   POST   /api/seller/products/image-upload-intent   — R2 presigned URL
 *   POST   /api/seller/products/save-image            — Save image metadata
 *   DELETE /api/seller/products/images/:imageId       — Delete product image
 *   PATCH  /api/seller/products/:productId/primary-image  — Set primary image
 *   PATCH  /api/seller/products/:productId/reorder-images — Reorder images
 *
 * Public endpoints (no auth):
 *   GET    /api/products/catalog                      — Public product catalog
 *   GET    /api/products/:productId                   — Product detail
 *   GET    /api/shops                                 — List public shops
 *   GET    /api/shops/:shopId                         — Shop detail
 *   GET    /api/categories                            — List categories
 */
import type { Express, Request, Response } from "express";
import { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireAuth } from "../middleware/auth.js";
import { query, getClient } from "../db/index.js";

// ─── R2 Client (reuse from upload.ts pattern) ─────────────────────────────

function getR2Config() {
  return {
    accountId: process.env.R2_ACCOUNT_ID || "",
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
    bucket: process.env.R2_BUCKET || "",
    publicDomain: process.env.R2_PUBLIC_DOMAIN || "",
  };
}

let _r2: S3Client | null = null;
function getR2(): S3Client {
  if (!_r2) {
    const cfg = getR2Config();
    _r2 = new S3Client({
      region: "auto",
      endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
    });
  }
  return _r2;
}

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Safely extract a route param as a string. */
function param(req: Request, key: string): string {
  const val = req.params[key] as string | string[] | undefined;
  if (Array.isArray(val)) return val[0] ?? "";
  return val ?? "";
}

/** Check if a string looks like a valid UUID (v4). */
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .substring(0, 120);
}

async function getSellerForUser(userId: string): Promise<{ id: string; status: string } | null> {
  const r = await query("SELECT id, status FROM sellers WHERE user_id = $1", [userId]);
  return r.rows[0] ?? null;
}

async function getShopForSeller(sellerId: string): Promise<{ id: string; name: string; slug: string } | null> {
  const r = await query("SELECT id, name, slug FROM shops WHERE seller_id = $1", [sellerId]);
  return r.rows[0] ?? null;
}

async function verifyProductOwnership(productId: string, sellerId: string): Promise<boolean> {
  const r = await query(
    `SELECT p.id FROM products p
     JOIN shops sh ON p.shop_id = sh.id
     WHERE p.id = $1 AND sh.seller_id = $2`,
    [productId, sellerId]
  );
  return r.rows.length > 0;
}

async function deleteR2Object(key: string): Promise<void> {
  try {
    await getR2().send(new DeleteObjectCommand({ Bucket: getR2Config().bucket, Key: key }));
  } catch {
    // Non-fatal — log and continue
    console.warn("[products] R2 delete failed for key:", key);
  }
}

function publicUrl(key: string): string {
  const pd = getR2Config().publicDomain;
  return pd ? `${pd}/${key}` : key;
}

/**
 * Convert a stored URL back to an R2 object key for deletion.
 * If the URL starts with the R2 public domain prefix, strip it.
 * Otherwise assume the URL is already the key (no publicDomain configured).
 */
function urlToKey(url: string): string {
  const pd = getR2Config().publicDomain;
  if (pd && url.startsWith(pd + "/")) {
    return url.substring(pd.length + 1);
  }
  return url;
}

/**
 * Format a product row from the DB into the StoreProduct shape expected by the frontend.
 */
function formatProduct(row: Record<string, any>, images: any[], inventory: any): any {
  const safeImages = Array.isArray(images) ? images : [];
  const primaryImage = safeImages.find((img: any) => img.sort_order === 0) ?? safeImages[0] ?? null;

  return {
    id: row.id,
    shopId: row.shop_id,
    sellerId: row.seller_id || "",
    name: row.name,
    description: row.description || null,
    category: row.category_id || "general",
    unit: row.unit || "ชิ้น",
    price: parseFloat(row.price) || 0,
    currency: row.currency || "THB",
    status: row.status || "draft",
    rejectionReason: row.rejection_reason || null,
    supplier: row.supplier || null,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
    images: safeImages.map((img: any) => ({
      id: img.id,
      productId: img.product_id,
      url: img.url,
      displayUrl: img.url,
      thumbUrl: img.url,
      storageProvider: "r2",
      storageKey: urlToKey(img.url),
      alt: img.alt || "",
      sortOrder: img.sort_order ?? 0,
      isPrimary: (img.sort_order ?? 0) === 0,
      width: null,
      height: null,
      createdAt: img.created_at ? new Date(img.created_at).getTime() : Date.now(),
    })),
    primaryImage: primaryImage
      ? {
          id: primaryImage.id,
          productId: primaryImage.product_id,
          url: primaryImage.url,
          displayUrl: primaryImage.url,
          thumbUrl: primaryImage.url,
          storageProvider: "r2",
          storageKey: primaryImage.url,
          alt: primaryImage.alt || "",
          sortOrder: primaryImage.sort_order ?? 0,
          isPrimary: true,
          width: null,
          height: null,
          createdAt: primaryImage.created_at ? new Date(primaryImage.created_at).getTime() : Date.now(),
        }
      : null,
    inventory: inventory
      ? {
          id: inventory.id,
          productId: inventory.product_id,
          shopId: row.shop_id,
          quantity: inventory.quantity ?? 0,
          reservedQuantity: inventory.reserved ?? 0,
          reorderLevel: inventory.low_stock_threshold ?? 5,
          warehouse: "",
          available: (inventory.quantity ?? 0) - (inventory.reserved ?? 0),
        }
      : null,
    shopName: row.shop_name ?? null,
    shopSlug: row.shop_slug ?? null,
    soldCount: row.sold_count ?? 0,
    rating: row.rating ? parseFloat(row.rating) : null,
    reviewCount: row.review_count ?? 0,
    // VelRepeat configuration (V0025 columns)
    vrepeatEnabled: row.vrepeat_enabled ?? false,
    vrepeatWeeklyEnabled: row.vrepeat_weekly_enabled ?? false,
    vrepeatMonthlyEnabled: row.vrepeat_monthly_enabled ?? false,
    vrepeatWeeklyPrice: row.vrepeat_weekly_price != null ? parseFloat(row.vrepeat_weekly_price) : null,
    vrepeatMonthlyPrice: row.vrepeat_monthly_price != null ? parseFloat(row.vrepeat_monthly_price) : null,
    vrepeatWeeklyQty: row.vrepeat_weekly_qty ?? null,
    vrepeatMonthlyQty: row.vrepeat_monthly_qty ?? null,
  };
}

/**
 * Load all images and inventory for a list of product IDs in bulk.
 */
async function loadProductExtras(productIds: string[]): Promise<{
  imagesByProduct: Map<string, any[]>;
  inventoryByProduct: Map<string, any>;
  variantsByProduct: Map<string, any[]>;
}> {
  if (productIds.length === 0) {
    return { imagesByProduct: new Map(), inventoryByProduct: new Map(), variantsByProduct: new Map() };
  }

  const imagesResult = await query(
    `SELECT * FROM product_images WHERE product_id = ANY($1) ORDER BY sort_order ASC`,
    [productIds]
  );
  const inventoryResult = await query(
    `SELECT * FROM inventory WHERE product_id = ANY($1)`,
    [productIds]
  );

  // Load variants
  let variantsResult = { rows: [] as any[] };
  try {
    variantsResult = await query(
      `SELECT * FROM product_variants WHERE product_id = ANY($1) AND status = 'active' ORDER BY sort_order ASC`,
      [productIds]
    );
  } catch {
    // product_variants table may not have all expected columns
    try {
      variantsResult = await query(
        `SELECT id, product_id, name, sku, price, stock, status, sort_order FROM product_variants WHERE product_id = ANY($1) AND status = 'active' ORDER BY sort_order ASC`,
        [productIds]
      );
    } catch { /* table may not exist yet */ }
  }

  const imagesByProduct = new Map<string, any[]>();
  for (const img of imagesResult.rows) {
    const list = imagesByProduct.get(img.product_id) ?? [];
    list.push(img);
    imagesByProduct.set(img.product_id, list);
  }

  const inventoryByProduct = new Map<string, any>();
  for (const inv of inventoryResult.rows) {
    inventoryByProduct.set(inv.product_id, inv);
  }

  const variantsByProduct = new Map<string, any[]>();
  for (const v of variantsResult.rows) {
    const list = variantsByProduct.get(v.product_id) ?? [];
    list.push({
      id: v.id,
      productId: v.product_id,
      name: v.name,
      sku: v.sku,
      price: parseFloat(v.price) || 0,
      stock: v.stock ?? 0,
      status: v.status || "active",
      options: v.options || {},
      sortOrder: v.sort_order ?? 0,
    });
    variantsByProduct.set(v.product_id, list);
  }

  return { imagesByProduct, inventoryByProduct, variantsByProduct };
}

/**
 * Load a single product with all images + inventory, formatted for frontend.
 * Used after image operations that need to return the full updated product.
 */
async function getFormattedProduct(productId: string, sellerId: string): Promise<any | null> {
  const result = await query(
    `SELECT p.*, sh.seller_id FROM products p JOIN shops sh ON p.shop_id = sh.id WHERE p.id = $1 AND sh.seller_id = $2`,
    [productId, sellerId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  const { imagesByProduct, inventoryByProduct, variantsByProduct } = await loadProductExtras([productId]);
  const formatted = formatProduct(
    { ...row, seller_id: sellerId },
    imagesByProduct.get(productId) ?? [],
    inventoryByProduct.get(productId) ?? null,
  );
  formatted.variants = variantsByProduct.get(productId) ?? [];
  return formatted;
}

// ─── Route Registration ───────────────────────────────────────────────────

export function setupProductRoutes(app: Express): void {

  // ═════════════════════════════════════════════════════════════════════════
  // SELLER ROUTES (authenticated, ownership verified)
  // ═════════════════════════════════════════════════════════════════════════

  // ── GET /api/seller/products ────────────────────────────────────────────
  app.get("/api/seller/products", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const seller = await getSellerForUser(userId);
      if (!seller) {
        res.json({ success: true, data: [] });
        return;
      }

      const shop = await getShopForSeller(seller.id);
      if (!shop) {
        res.json({ success: true, data: [] });
        return;
      }

      const result = await query(
        `SELECT p.*, sh.seller_id
         FROM products p
         JOIN shops sh ON p.shop_id = sh.id
         WHERE p.shop_id = $1
         ORDER BY p.created_at DESC`,
        [shop.id]
      );

      const productIds = result.rows.map((r: any) => r.id);
      const { imagesByProduct, inventoryByProduct, variantsByProduct } = await loadProductExtras(productIds);

      const products = result.rows.map((row: any) => {
        const formatted = formatProduct(
          { ...row, seller_id: seller.id },
          imagesByProduct.get(row.id) ?? [],
          inventoryByProduct.get(row.id) ?? null
        );
        formatted.variants = variantsByProduct.get(row.id) ?? [];
        return formatted;
      });

      res.json({ success: true, data: products });
    } catch (err) {
      console.error("[products] list seller products error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to list products" } });
    }
  });

  // ── POST /api/seller/products ───────────────────────────────────────────
  app.post("/api/seller/products", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const seller = await getSellerForUser(userId);
      if (!seller || seller.status !== "approved") {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Only approved sellers can create products" } });
        return;
      }

      const shop = await getShopForSeller(seller.id);
      if (!shop) {
        res.status(404).json({ success: false, error: { code: "NO_SHOP", message: "No shop found for this seller" } });
        return;
      }

      const { name, category, unit, price, description, supplier, status, initialStock, reorderLevel, compareAtPrice, shortDescription } = req.body;

      // Validate
      if (!name || typeof name !== "string" || !name.trim()) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Product name is required" } });
        return;
      }
      const priceNum = Number(price);
      if (!Number.isFinite(priceNum) || priceNum < 0) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Valid price is required" } });
        return;
      }

      // Validate category — must be one of the known StoreProductCategory values
      const VALID_CATEGORIES = ["general", "food", "daily", "beauty", "packaging", "other"];
      if (category !== undefined && category !== null && category !== "") {
        if (typeof category !== "string" || !VALID_CATEGORIES.includes(category.trim())) {
          res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}` } });
          return;
        }
      }

      // Generate unique slug
      const baseSlug = slugify(name.trim());
      let slug = baseSlug;
      let suffix = 1;
      while (true) {
        const slugCheck = await query("SELECT id FROM products WHERE slug = $1", [slug]);
        if (slugCheck.rows.length === 0) break;
        slug = `${baseSlug}-${suffix}`;
        suffix++;
      }

      const productStatus = status === "published" ? "pending_review" : "draft";
      const stockQty = initialStock != null ? Math.max(0, Number(initialStock)) : 0;
      const reorder = reorderLevel != null ? Math.max(0, Number(reorderLevel)) : 5;

      // category: frontend sends simple strings ("food", "general", etc.)
      // not UUIDs. Store as TEXT in the category_id column.
      const resolvedCategory = (category && typeof category === "string" && category.trim())
        ? category.trim() : null;

      // ── Transaction: create product + inventory + update shop count ──
      const client = await getClient();
      try {
        await client.query("BEGIN");

        const insertResult = await client.query(
          `INSERT INTO products (shop_id, name, slug, description, short_description, price, compare_at_price, currency, unit, supplier, status, category_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'THB', $8, $9, $10, $11)
           RETURNING *`,
          [
            shop.id,
            name.trim(),
            slug,
            description || "",
            shortDescription || null,
            priceNum,
            compareAtPrice ? Number(compareAtPrice) : null,
            unit || "ชิ้น",
            supplier || null,
            productStatus,
            resolvedCategory,
          ]
        );

        const product = insertResult.rows[0];

        await client.query(
          `INSERT INTO inventory (product_id, quantity, reserved, low_stock_threshold)
           VALUES ($1, $2, 0, $3)`,
          [product.id, stockQty, reorder]
        );

        // product_count only reflects published products — no increment here (new product starts as draft/pending_review)

        await client.query("COMMIT");

        // Store product for response formatting
        var createdProduct = product;
      } catch (txErr) {
        await client.query("ROLLBACK").catch(() => {});
        throw txErr;
      } finally {
        client.release();
      }

      console.log(`[products] created: ${createdProduct.id} (shop ${shop.id}) by seller ${seller.id}`);

      const formatResult = formatProduct(
        { ...createdProduct, seller_id: seller.id },
        [],
        { id: createdProduct.id, product_id: createdProduct.id, quantity: stockQty, reserved: 0, low_stock_threshold: reorder }
      );

      res.json({ success: true, data: formatResult });
    } catch (err) {
      console.error("[products] create error:", err);
      res.status(500).json({ success: false, error: { code: "CREATE_FAILED", message: "Failed to create product" } });
    }
  });

  // ── PATCH /api/seller/products/:productId ───────────────────────────────
  app.patch("/api/seller/products/:productId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const seller = await getSellerForUser(userId);
      if (!seller) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not a seller" } });
        return;
      }

      const productId = param(req, "productId");
      if (!(await verifyProductOwnership(productId, seller.id))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Product does not belong to this seller" } });
        return;
      }

      const { name, category, unit, price, description, supplier, status, compareAtPrice, shortDescription } = req.body;

      // Validate category if provided
      const VALID_CATEGORIES = ["general", "food", "daily", "beauty", "packaging", "other"];
      if (category !== undefined && category !== null && category !== "") {
        if (typeof category !== "string" || !VALID_CATEGORIES.includes(category.trim())) {
          res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}` } });
          return;
        }
      }

      const updates: string[] = [];
      const values: any[] = [];
      let idx = 1;

      if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(name.trim()); }
      if (description !== undefined) { updates.push(`description = $${idx++}`); values.push(description); }
      if (shortDescription !== undefined) { updates.push(`short_description = $${idx++}`); values.push(shortDescription); }
      if (price !== undefined) { updates.push(`price = $${idx++}`); values.push(Number(price)); }
      if (compareAtPrice !== undefined) { updates.push(`compare_at_price = $${idx++}`); values.push(compareAtPrice ? Number(compareAtPrice) : null); }
      if (unit !== undefined) { updates.push(`unit = $${idx++}`); values.push(unit); }
      if (supplier !== undefined) { updates.push(`supplier = $${idx++}`); values.push(supplier || null); }
      if (category !== undefined) {
        const catVal = (typeof category === "string" && category.trim()) ? category.trim() : null;
        updates.push(`category_id = $${idx++}`); values.push(catVal);
      }
      if (status !== undefined) {
        const validStatuses = ["draft", "published", "pending_review", "rejected", "archived"];
        if (!validStatuses.includes(status)) {
          res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: `Invalid status: ${status}` } });
          return;
        }
        // Seller transition validation: sellers can only submit (-> pending_review) or withdraw (-> draft)
        const currentResult = await query("SELECT status FROM products WHERE id = $1", [productId]);
        if (currentResult.rows.length === 0) {
          res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Product not found" } });
          return;
        }
        const currentStatus = currentResult.rows[0].status;
        const SELLER_TRANSITIONS: Record<string, string[]> = {
          draft: ["pending_review"],
          rejected: ["pending_review"],
          pending_review: ["draft"],
        };
        const allowed = SELLER_TRANSITIONS[currentStatus];
        if (!allowed || !allowed.includes(status)) {
          res.status(400).json({ success: false, error: { code: "INVALID_TRANSITION", message: `Cannot change product from ${currentStatus} to ${status}. Allowed: ${(allowed ?? []).join(", ") || "none"}` } });
          return;
        }
        updates.push(`status = $${idx++}`); values.push(status);
        // Clear rejection_reason when resubmitting
        if (status === "pending_review") {
          updates.push(`rejection_reason = NULL`);
        }
      }
      updates.push(`updated_at = NOW()`);

      if (updates.length === 1) {
        res.json({ success: true, data: null });
        return;
      }

      values.push(productId);
      const result = await query(
        `UPDATE products SET ${updates.join(", ")} WHERE id = $${idx} RETURNING *`,
        values
      );

      if (result.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Product not found" } });
        return;
      }

      const row = result.rows[0];
      const { imagesByProduct, inventoryByProduct, variantsByProduct } = await loadProductExtras([productId]);

      const formatted = formatProduct(
        { ...row, seller_id: seller.id },
        imagesByProduct.get(productId) ?? [],
        inventoryByProduct.get(productId) ?? null
      );
      formatted.variants = variantsByProduct.get(productId) ?? [];

      console.log(`[products] updated: ${productId} by seller ${seller.id}`);

      res.json({ success: true, data: formatted });
    } catch (err) {
      console.error("[products] update error:", err);
      res.status(500).json({ success: false, error: { code: "UPDATE_FAILED", message: "Failed to update product" } });
    }
  });

  // ── DELETE /api/seller/products/:productId ──────────────────────────────
  app.delete("/api/seller/products/:productId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const seller = await getSellerForUser(userId);
      if (!seller) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not a seller" } });
        return;
      }

      const productId = param(req, "productId");
      if (!(await verifyProductOwnership(productId, seller.id))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Product does not belong to this seller" } });
        return;
      }

      // Delete product images from R2
      const images = await query("SELECT url FROM product_images WHERE product_id = $1", [productId]);
      for (const img of images.rows) {
        if (img.url) deleteR2Object(urlToKey(img.url));
      }

      // Delete product (CASCADE handles product_images and inventory)
      const shopResult = await query(
        `DELETE FROM products WHERE id = $1 RETURNING shop_id`,
        [productId]
      );

      // Decrement shop product count
      if (shopResult.rows[0]?.shop_id) {
        await query(
          "UPDATE shops SET product_count = GREATEST(product_count - 1, 0), updated_at = NOW() WHERE id = $1",
          [shopResult.rows[0].shop_id]
        );
      }

      console.log(`[products] deleted: ${productId} by seller ${seller.id}`);

      res.json({ success: true, data: { id: productId } });
    } catch (err) {
      console.error("[products] delete error:", err);
      res.status(500).json({ success: false, error: { code: "DELETE_FAILED", message: "Failed to delete product" } });
    }
  });

  // ── PATCH /api/seller/products/:productId/status ────────────────────────
  app.patch("/api/seller/products/:productId/status", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const seller = await getSellerForUser(userId);
      if (!seller) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not a seller" } });
        return;
      }

      const productId = param(req, "productId");
      if (!(await verifyProductOwnership(productId, seller.id))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Product does not belong to this seller" } });
        return;
      }

      const { status } = req.body;
      const validStatuses = ["draft", "pending_review"];
      if (!status || !validStatuses.includes(status)) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: `Sellers can only set status to: ${validStatuses.join(", ")}` } });
        return;
      }

      // CRITICAL: Enforce state machine — sellers CANNOT set published/rejected/archived
      const SELLER_STATUS_TRANSITIONS: Record<string, string[]> = {
        draft: ["pending_review"],
        rejected: ["pending_review"],
        pending_review: ["draft"],
      };
      const currentStatusResult = await query("SELECT status FROM products WHERE id = $1", [productId]);
      if (currentStatusResult.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Product not found" } });
        return;
      }
      const currentStatus = currentStatusResult.rows[0].status;
      const allowedTransitions = SELLER_STATUS_TRANSITIONS[currentStatus];
      if (!allowedTransitions || !allowedTransitions.includes(status)) {
        res.status(403).json({ success: false, error: { code: "INVALID_TRANSITION", message: `Cannot change status from '${currentStatus}' to '${status}'. Sellers can only: ${Object.entries(SELLER_STATUS_TRANSITIONS).map(([from, to]) => `${from} -> ${to.join(', ')}`).join('; ')}` } });
        return;
      }

      // Clear rejection_reason when resubmitting
      const statusUpdates = [`status = $1`, `updated_at = NOW()`];
      const statusValues: any[] = [status];
      let statusIdx = 2;
      if (status === "pending_review") {
        statusUpdates.push(`rejection_reason = NULL`);
      }

      // Check auto-approval mode
      let finalStatus = status;
      let actorLog = `seller ${seller.id}`;
      if (status === "pending_review") {
        try {
          const modeResult = await query(
            "SELECT value FROM platform_settings WHERE key = 'product_approval_mode'", []
          );
          const approvalMode = modeResult.rows[0]?.value ?? "manual";
          if (approvalMode === "auto") {
            finalStatus = "published";
            statusUpdates[0] = `status = $1`;
            statusValues[0] = "published";
            console.log(`[products] auto-approval: ${productId} auto-published (mode=auto)`);
            actorLog = `system:auto_approval`;
          }
        } catch {
          // platform_settings table may not exist yet — default to manual
        }
      }

      console.log(`[products] status transition: ${productId} from '${currentStatus}' to '${finalStatus}' by ${actorLog}`);

      const result = await query(
        `UPDATE products SET ${statusUpdates.join(", ")} WHERE id = $${statusIdx} RETURNING *`,
        [...statusValues, productId]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Product not found" } });
        return;
      }

      // Update shop product_count if status became published
      if (finalStatus === "published") {
        const shopResult = await query("SELECT shop_id FROM products WHERE id = $1", [productId]);
        if (shopResult.rows[0]?.shop_id) {
          const countResult = await query(
            "SELECT COUNT(*) as cnt FROM products WHERE shop_id = $1 AND status = 'published'",
            [shopResult.rows[0].shop_id]
          );
          await query(
            "UPDATE shops SET product_count = $1, updated_at = NOW() WHERE id = $2",
            [parseInt(countResult.rows[0].cnt), shopResult.rows[0].shop_id]
          );
        }
      }

      const row = result.rows[0];
      const { imagesByProduct, inventoryByProduct, variantsByProduct } = await loadProductExtras([productId]);

      const formatted = formatProduct(
        { ...row, seller_id: seller.id },
        imagesByProduct.get(productId) ?? [],
        inventoryByProduct.get(productId) ?? null
      );
      formatted.variants = variantsByProduct.get(productId) ?? [];

      console.log(`[products] status changed: ${productId} -> ${finalStatus} by ${actorLog}`);

      // Write audit log
      try {
        await query(
          `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
           VALUES ($1, 'product_status_change', 'product', $2, $3)`,
          [userId, productId, JSON.stringify({ from: currentStatus, to: finalStatus, autoApproved: finalStatus !== status })]
        );
      } catch { /* audit log is best-effort */ }

      res.json({ success: true, data: formatted });
    } catch (err) {
      console.error("[products] status error:", err);
      res.status(500).json({ success: false, error: { code: "STATUS_FAILED", message: "Failed to update product status" } });
    }
  });

  // ── PATCH /api/seller/products/:productId/stock ─────────────────────────
  app.patch("/api/seller/products/:productId/stock", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const seller = await getSellerForUser(userId);
      if (!seller) { res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not a seller" } }); return; }

      const productId = param(req, "productId");
      if (!(await verifyProductOwnership(productId, seller.id))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not your product" } }); return;
      }

      const { quantity } = req.body;
      const qty = Math.max(0, Number(quantity) || 0);

      await query(
        `INSERT INTO inventory (product_id, quantity, reserved, low_stock_threshold, updated_at)
         VALUES ($1, $2, 0, 5, NOW())
         ON CONFLICT (product_id)
         DO UPDATE SET quantity = $2, updated_at = NOW()`,
        [productId, qty]
      );

      console.log(`[products] stock set: ${productId} -> ${qty} by seller ${seller.id}`);

      res.json({ success: true, data: { productId, quantity: qty } });
    } catch (err) {
      console.error("[products] stock error:", err);
      res.status(500).json({ success: false, error: { code: "STOCK_FAILED", message: "Failed to update stock" } });
    }
  });

  // ── PATCH /api/seller/products/:productId/reorder-level ─────────────────
  app.patch("/api/seller/products/:productId/reorder-level", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const seller = await getSellerForUser(userId);
      if (!seller) { res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not a seller" } }); return; }

      const productId = param(req, "productId");
      if (!(await verifyProductOwnership(productId, seller.id))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not your product" } }); return;
      }

      const { reorderLevel } = req.body;
      const rl = Math.max(0, Number(reorderLevel) || 0);

      await query(
        `INSERT INTO inventory (product_id, quantity, reserved, low_stock_threshold, updated_at)
         VALUES ($1, 0, 0, $2, NOW())
         ON CONFLICT (product_id)
         DO UPDATE SET low_stock_threshold = $2, updated_at = NOW()`,
        [productId, rl]
      );

      console.log(`[products] reorder level set: ${productId} -> ${rl} by seller ${seller.id}`);

      res.json({ success: true, data: { productId, reorderLevel: rl } });
    } catch (err) {
      console.error("[products] reorder-level error:", err);
      res.status(500).json({ success: false, error: { code: "REORDER_FAILED", message: "Failed to update reorder level" } });
    }
  });

  // ── POST /api/seller/products/image-upload-intent ───────────────────────
  app.post("/api/seller/products/image-upload-intent", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const seller = await getSellerForUser(userId);
      if (!seller) { res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not a seller" } }); return; }

      const { productId, filename, mimeType } = req.body;
      if (!productId || !filename || !mimeType) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "productId, filename, mimeType required" } });
        return;
      }

      if (!ALLOWED_IMAGE_TYPES.includes(mimeType)) {
        res.status(400).json({ success: false, error: { code: "INVALID_FILE_TYPE", message: "File type not allowed" } });
        return;
      }

      if (!(await verifyProductOwnership(productId, seller.id))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Product does not belong to this seller" } });
        return;
      }

      const shop = await getShopForSeller(seller.id);
      if (!shop) { res.status(404).json({ success: false, error: { code: "NO_SHOP", message: "No shop found" } }); return; }

      const uniqueId = crypto.randomUUID().replace(/-/g, "").substring(0, 12);
      const objectKey = `products/${shop.id}/${productId}/${uniqueId}.webp`;

      const command = new PutObjectCommand({
        Bucket: getR2Config().bucket,
        Key: objectKey,
        ContentType: mimeType,
      });

      const uploadUrl = await getSignedUrl(getR2(), command, { expiresIn: 300 });
      const cdnUrl = publicUrl(objectKey);

      console.log(`[products] image intent: ${objectKey} for product ${productId}`);

      res.json({
        success: true,
        data: {
          uploadUrl,
          objectKey,
          cdnUrl,
          expiresAt: Date.now() + 300_000,
        },
      });
    } catch (err) {
      console.error("[products] image intent error:", err);
      res.status(500).json({ success: false, error: { code: "R2_PRESIGN_FAILED", message: "Failed to generate upload URL" } });
    }
  });

  // ── POST /api/seller/products/save-image ────────────────────────────────
  app.post("/api/seller/products/save-image", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const seller = await getSellerForUser(userId);
      if (!seller) { res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not a seller" } }); return; }

      const { productId, objectKey, cdnUrl, alt } = req.body;
      if (!productId || !objectKey) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "productId and objectKey required" } });
        return;
      }

      if (!(await verifyProductOwnership(productId, seller.id))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Product does not belong to this seller" } });
        return;
      }

      // Verify R2 object exists
      try {
        await getR2().send(new HeadObjectCommand({ Bucket: getR2Config().bucket, Key: objectKey }));
      } catch {
        res.status(400).json({ success: false, error: { code: "R2_OBJECT_NOT_FOUND", message: "Upload not found in storage" } });
        return;
      }

      const url = cdnUrl || publicUrl(objectKey);

      // Get current max sort_order
      const maxSort = await query(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 as next_sort FROM product_images WHERE product_id = $1",
        [productId]
      );
      const sortOrder = maxSort.rows[0]?.next_sort ?? 0;

      const result = await query(
        `INSERT INTO product_images (product_id, url, alt, sort_order)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [productId, url, alt || "", sortOrder]
      );

      console.log(`[products] image saved: ${result.rows[0].id} for product ${productId}`);

      // Return the full updated product so the frontend can update its state
      const updatedProduct = await getFormattedProduct(productId, seller.id);
      res.json({ success: true, data: updatedProduct });
    } catch (err) {
      console.error("[products] save-image error:", err);
      res.status(500).json({ success: false, error: { code: "IMAGE_SAVE_FAILED", message: "Failed to save image" } });
    }
  });

  // ── DELETE /api/seller/products/images/:imageId ─────────────────────────
  app.delete("/api/seller/products/images/:imageId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const seller = await getSellerForUser(userId);
      if (!seller) { res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not a seller" } }); return; }

      const imageId = param(req, "imageId");

      // Get the image and verify ownership through product -> shop -> seller
      const imgResult = await query(
        `SELECT pi.* FROM product_images pi
         JOIN products p ON pi.product_id = p.id
         JOIN shops sh ON p.shop_id = sh.id
         WHERE pi.id = $1 AND sh.seller_id = $2`,
        [imageId, seller.id]
      );

      if (imgResult.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Image not found" } });
        return;
      }

      const img = imgResult.rows[0];

      // Delete from R2
      if (img.url) deleteR2Object(urlToKey(img.url));

      // Delete from DB
      await query("DELETE FROM product_images WHERE id = $1", [imageId]);

      // Reorder remaining images
      const remaining = await query(
        "SELECT id FROM product_images WHERE product_id = $1 ORDER BY sort_order ASC",
        [img.product_id]
      );
      for (let i = 0; i < remaining.rows.length; i++) {
        await query("UPDATE product_images SET sort_order = $1 WHERE id = $2", [i, remaining.rows[i].id]);
      }

      console.log(`[products] image deleted: ${imageId} by seller ${seller.id}`);

      // Return the full updated product so the frontend can update its state
      const updatedProduct = await getFormattedProduct(img.product_id, seller.id);
      res.json({ success: true, data: updatedProduct });
    } catch (err) {
      console.error("[products] delete-image error:", err);
      res.status(500).json({ success: false, error: { code: "DELETE_FAILED", message: "Failed to delete image" } });
    }
  });

  // ── PATCH /api/seller/products/:productId/primary-image ─────────────────
  app.patch("/api/seller/products/:productId/primary-image", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const seller = await getSellerForUser(userId);
      if (!seller) { res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not a seller" } }); return; }

      const productId = param(req, "productId");
      if (!(await verifyProductOwnership(productId, seller.id))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not your product" } }); return;
      }

      const { imageId } = req.body;
      if (!imageId) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "imageId required" } });
        return;
      }

      // Verify image belongs to this product
      const imgCheck = await query(
        "SELECT id FROM product_images WHERE id = $1 AND product_id = $2",
        [imageId, productId]
      );
      if (imgCheck.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Image not found for this product" } });
        return;
      }

      // Reset all sort_orders, then set the primary to 0
      await query("UPDATE product_images SET sort_order = sort_order + 1000 WHERE product_id = $1", [productId]);
      await query("UPDATE product_images SET sort_order = 0 WHERE id = $1", [imageId]);

      // Compact sort orders
      const all = await query(
        "SELECT id FROM product_images WHERE product_id = $1 ORDER BY sort_order ASC",
        [productId]
      );
      for (let i = 0; i < all.rows.length; i++) {
        await query("UPDATE product_images SET sort_order = $1 WHERE id = $2", [i, all.rows[i].id]);
      }

      console.log(`[products] primary image set: ${imageId} for product ${productId}`);

      // Return the full updated product so the frontend can update its state
      const updatedProduct = await getFormattedProduct(productId, seller.id);
      res.json({ success: true, data: updatedProduct });
    } catch (err) {
      console.error("[products] primary-image error:", err);
      res.status(500).json({ success: false, error: { code: "PRIMARY_FAILED", message: "Failed to set primary image" } });
    }
  });

  // ── PATCH /api/seller/products/:productId/reorder-images ────────────────
  app.patch("/api/seller/products/:productId/reorder-images", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const seller = await getSellerForUser(userId);
      if (!seller) { res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not a seller" } }); return; }

      const productId = param(req, "productId");
      if (!(await verifyProductOwnership(productId, seller.id))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not your product" } }); return;
      }

      // Accept both "imageIds" (backend convention) and "orderedIds" (frontend sends this)
      const { imageIds: rawImageIds, orderedIds } = req.body;
      const imageIds: string[] = Array.isArray(rawImageIds) ? rawImageIds : Array.isArray(orderedIds) ? orderedIds : [];
      if (imageIds.length === 0) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "imageIds/orderedIds array required" } });
        return;
      }

      for (let i = 0; i < imageIds.length; i++) {
        await query(
          "UPDATE product_images SET sort_order = $1 WHERE id = $2 AND product_id = $3",
          [i, imageIds[i], productId]
        );
      }

      console.log(`[products] images reordered: ${productId} (${imageIds.length} images) by seller ${seller.id}`);

      // Return the full updated product so the frontend can update its state
      const updatedProduct = await getFormattedProduct(productId, seller.id);
      res.json({ success: true, data: updatedProduct });
    } catch (err) {
      console.error("[products] reorder-images error:", err);
      res.status(500).json({ success: false, error: { code: "REORDER_FAILED", message: "Failed to reorder images" } });
    }
  });

  // ═════════════════════════════════════════════════════════════════════════
  // PUBLIC CATALOG ROUTES (no auth required)
  // ═════════════════════════════════════════════════════════════════════════

  // ── GET /api/products/catalog ───────────────────────────────────────────
  app.get("/api/products/catalog", async (req: Request, res: Response) => {
    try {
      const { q, category, shopId, minPrice, maxPrice, inStock, sortBy, limit: limitStr, offset: offsetStr } = req.query;
      const limit = Math.min(Number(limitStr) || 50, 200);
      const offset = Number(offsetStr) || 0;

      let where = "WHERE p.status = 'published'";
      const params: any[] = [];
      let idx = 1;

      if (q && typeof q === "string") {
        where += ` AND (p.name ILIKE $${idx} OR p.description ILIKE $${idx})`;
        params.push(`%${q}%`);
        idx++;
      }
      if (category && typeof category === "string") {
        where += ` AND p.category_id = $${idx}`;
        params.push(category);
        idx++;
      }
      if (shopId && typeof shopId === "string") {
        where += ` AND p.shop_id = $${idx}`;
        params.push(shopId);
        idx++;
      }
      if (minPrice) {
        where += ` AND p.price >= $${idx}`;
        params.push(Number(minPrice));
        idx++;
      }
      if (maxPrice) {
        where += ` AND p.price <= $${idx}`;
        params.push(Number(maxPrice));
        idx++;
      }
      if (inStock === "true") {
        where += ` AND EXISTS (SELECT 1 FROM inventory inv WHERE inv.product_id = p.id AND inv.quantity > inv.reserved)`;
      }

      let orderBy = "ORDER BY p.created_at DESC";
      if (sortBy === "price_asc") orderBy = "ORDER BY p.price ASC";
      if (sortBy === "price_desc") orderBy = "ORDER BY p.price DESC";
      if (sortBy === "popular") orderBy = "ORDER BY p.sold_count DESC";

      const result = await query(
        `SELECT p.*, sh.name as shop_name, sh.slug as shop_slug, sh.seller_id
         FROM products p
         JOIN shops sh ON p.shop_id = sh.id
         ${where}
         ${orderBy}
         LIMIT $${idx++} OFFSET $${idx}`,
        [...params, limit, offset]
      );

      const productIds = result.rows.map((r: any) => r.id);
      const { imagesByProduct, inventoryByProduct, variantsByProduct } = await loadProductExtras(productIds);

      const products = result.rows.map((row: any) => {
        const formatted = formatProduct(row, imagesByProduct.get(row.id) ?? [], inventoryByProduct.get(row.id) ?? null);
        formatted.variants = variantsByProduct.get(row.id) ?? [];
        return formatted;
      });

      res.json({ success: true, data: products });
    } catch (err) {
      console.error("[products] catalog error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch catalog" } });
    }
  });

  // ── GET /api/products/:productId ────────────────────────────────────────
  app.get("/api/products/:productId", async (req: Request, res: Response) => {
    try {
      const productId = param(req, "productId");
      console.log(`[products] detail request: id=${productId}`);

      // Public access only shows published products
      const result = await query(
        `SELECT p.*, sh.name as shop_name, sh.slug as shop_slug, sh.seller_id
         FROM products p
         JOIN shops sh ON p.shop_id = sh.id
         WHERE p.id = $1 AND p.status = 'published'`,
        [productId]
      );

      if (result.rows.length === 0) {
        // Check if product exists but has different status
        const anyResult = await query(
          `SELECT id, status, shop_id FROM products WHERE id = $1`,
          [productId]
        );
        if (anyResult.rows.length > 0) {
          const p = anyResult.rows[0];
          console.log(`[products] detail: product found but status='${p.status}' (not published), shop_id=${p.shop_id}`);
        } else {
          console.log(`[products] detail: no product found with id=${productId}`);
        }
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Product not found" } });
        return;
      }
      console.log(`[products] detail: found product '${result.rows[0].name}' status='${result.rows[0].status}'`);

      const row = result.rows[0];
      const { imagesByProduct, inventoryByProduct, variantsByProduct } = await loadProductExtras([productId]);

      const formatted = formatProduct(
        row,
        imagesByProduct.get(productId) ?? [],
        inventoryByProduct.get(productId) ?? null
      );
      formatted.variants = variantsByProduct.get(productId) ?? [];

      // Also fetch shop info for the detail page
      const shopResult = await query(
        "SELECT id, name, slug, description, logo, cover, rating, product_count FROM shops WHERE id = $1",
        [row.shop_id],
      );
      if (shopResult.rows.length > 0) {
        const s = shopResult.rows[0];
        formatted.shop = {
          id: s.id,
          name: s.name,
          slug: s.slug,
          description: s.description,
          logo: s.logo,
          cover: s.cover,
          rating: s.rating,
          productCount: s.product_count,
        };
      }

      // Load dynamic option groups + values (V0027 tables)
      try {
        const groupsResult = await query(
          "SELECT * FROM product_option_groups WHERE product_id = $1 ORDER BY sort_order ASC",
          [productId]
        );
        const optionGroups = [];
        for (const group of groupsResult.rows) {
          const valuesResult = await query(
            "SELECT * FROM product_option_values WHERE option_group_id = $1 ORDER BY sort_order ASC",
            [group.id]
          );
          optionGroups.push({
            id: group.id,
            name: group.name,
            displayType: group.display_type,
            required: group.required,
            sortOrder: group.sort_order,
            values: valuesResult.rows.map((v: any) => ({
              id: v.id,
              value: v.value,
              label: v.label || v.value,
              imageUrl: v.image_url,
              sortOrder: v.sort_order,
            })),
          });
        }
        formatted.optionGroups = optionGroups;
      } catch { /* product_option_groups table may not exist yet */ }

      // Load product attributes (V0027 tables)
      try {
        const attrsResult = await query(
          "SELECT * FROM product_attributes WHERE product_id = $1 ORDER BY sort_order ASC",
          [productId]
        );
        formatted.attributes = attrsResult.rows.map((a: any) => ({
          id: a.id,
          name: a.name,
          value: a.value,
          sortOrder: a.sort_order,
        }));
      } catch { /* product_attributes table may not exist yet */ }

      // Load variant-to-option mappings (V0027 tables)
      try {
        const variantValuesResult = await query(
          `SELECT pvv.variant_id, pvv.option_value_id,
                  pov.option_group_id, pov.value
           FROM product_variant_values pvv
           JOIN product_option_values pov ON pvv.option_value_id = pov.id
           JOIN product_variants pv ON pvv.variant_id = pv.id
           WHERE pv.product_id = $1`,
          [productId]
        );
        const variantOptions: Record<string, Record<string, string>> = {};
        for (const row of variantValuesResult.rows) {
          const vid = row.variant_id as string;
          const gid = row.option_group_id as string;
          if (!variantOptions[vid]) variantOptions[vid] = {};
          variantOptions[vid][gid] = row.value as string;
        }
        formatted.variantOptions = variantOptions;
      } catch { /* product_variant_values table may not exist yet */ }

      res.json({ success: true, data: formatted });
    } catch (err) {
      console.error("[products] detail error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch product" } });
    }
  });

  // ── GET /api/shops ──────────────────────────────────────────────────────
  app.get("/api/shops", async (_req: Request, res: Response) => {
    try {
      const result = await query(
        `SELECT sh.*, s.status as seller_status
         FROM shops sh
         JOIN sellers s ON sh.seller_id = s.id
         WHERE s.status = 'approved'
         ORDER BY sh.product_count DESC, sh.created_at DESC`
      );

      const shops = result.rows.map((row: any) => ({
        id: row.id,
        sellerId: row.seller_id,
        name: row.name,
        slug: row.slug,
        description: row.description,
        imageUrl: row.logo,
        phone: null,
        address: null,
        announcement: null,
        status: "active",
        commissionRate: 0.03,
        currency: "THB",
        createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
      }));

      res.json({ success: true, data: shops });
    } catch (err) {
      console.error("[products] shops list error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch shops" } });
    }
  });

  // ── GET /api/shops/:shopId ──────────────────────────────────────────────
  app.get("/api/shops/:shopId", async (req: Request, res: Response) => {
    try {
      const shopId = param(req, "shopId");
      console.log(`[shop detail] requested shopId=${shopId} isUuid=${isUuid(shopId)}`);

      // PostgreSQL cannot compare UUID = text in an OR branch.
      // We must route to the correct column based on input format.
      const shopQuery = isUuid(shopId)
        ? `SELECT sh.*, s.status as seller_status
           FROM shops sh
           JOIN sellers s ON sh.seller_id = s.id
           WHERE sh.id = $1 AND s.status = 'approved'`
        : `SELECT sh.*, s.status as seller_status
           FROM shops sh
           JOIN sellers s ON sh.seller_id = s.id
           WHERE sh.slug = $1 AND s.status = 'approved'`;
      const result = await query(shopQuery, [shopId]);
      console.log(`[shop detail] found ${result.rows.length} shop(s)`);

      if (result.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Shop not found" } });
        return;
      }

      const row = result.rows[0];
      console.log(`[shop detail] found shop id=${row.id} slug=${row.slug} seller_status=${row.seller_status}`);
      const shop = {
        id: row.id,
        sellerId: row.seller_id,
        name: row.name,
        slug: row.slug,
        description: row.description,
        logo: row.logo ?? null,
        cover: row.cover ?? null,
        imageUrl: row.logo ?? null,
        phone: row.phone ?? null,
        address: row.address ?? null,
        announcement: row.announcement ?? null,
        status: row.status ?? "active",
        currency: row.currency ?? "THB",
        createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
        productCount: parseInt(row.product_count ?? '0', 10),
        orderCount: parseInt(row.order_count ?? '0', 10),
        rating: row.rating != null ? parseFloat(row.rating) : null,
        reviewCount: parseInt(row.review_count ?? '0', 10),
      };

      // Fetch published products for this shop
      const productsResult = await query(
        `SELECT p.*,
                i.quantity AS stock_qty,
                i.reserved AS stock_reserved,
                (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order ASC LIMIT 1) AS primary_image_url
         FROM products p
         LEFT JOIN inventory i ON i.product_id = p.id
         WHERE p.shop_id = $1 AND p.status = 'published'
         ORDER BY p.created_at DESC
         LIMIT 50`,
        [row.id],
      );

      const productIds = productsResult.rows.map((r: any) => r.id);
      console.log(`[shop detail] products found=${productIds.length}`);
      const shopExtras = productIds.length > 0 ? await loadProductExtras(productIds) : { imagesByProduct: new Map(), inventoryByProduct: new Map(), variantsByProduct: new Map() };
      const products = productsResult.rows.map((r: any) => {
        const formatted = formatProduct(
          { ...r, seller_id: row.seller_id },
          shopExtras.imagesByProduct.get(r.id) ?? [],
          r.stock_qty != null ? { quantity: r.stock_qty, reserved: r.stock_reserved ?? 0 } : null,
        );
        formatted.variants = shopExtras.variantsByProduct.get(r.id) ?? [];
        return formatted;
      });

      res.json({ success: true, data: { shop, products } });
    } catch (err) {
      console.error("[products] shop detail error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch shop" } });
    }
  });

  // ── GET /api/categories ─────────────────────────────────────────────────
  app.get("/api/categories", async (_req: Request, res: Response) => {
    try {
      const result = await query(
        "SELECT id, name, slug, icon, parent_id, sort_order FROM categories ORDER BY sort_order ASC, name ASC"
      );
      res.json({ success: true, data: result.rows });
    } catch (err) {
      console.error("[products] categories error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch categories" } });
    }
  });

  // ── GET /api/products/:productId/reviews ───────────────────────────────
  // Returns product reviews (empty array if no reviews table yet)
  app.get("/api/products/:productId/reviews", async (req: Request, res: Response) => {
    try {
      const productId = param(req, "productId");
      // Check if reviews table exists
      const tableCheck = await query(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'product_reviews') AS exists`
      );
      if (!tableCheck.rows[0]?.exists) {
        res.json({ success: true, data: [] });
        return;
      }
      const result = await query(
        `SELECT pr.*, u.name AS customer_name
         FROM product_reviews pr
         LEFT JOIN users u ON pr.user_id = u.id
         WHERE pr.product_id = $1 AND pr.status = 'approved'
         ORDER BY pr.created_at DESC
         LIMIT 50`,
        [productId],
      );
      const reviews = result.rows.map((r: any) => ({
        id: r.id,
        productId: r.product_id,
        shopId: r.shop_id ?? '',
        userId: r.user_id,
        orderId: r.order_id ?? null,
        rating: r.rating,
        title: r.title ?? null,
        comment: r.comment ?? null,
        images: r.images ?? [],
        status: r.status,
        createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
        customerName: r.customer_name ?? null,
      }));
      res.json({ success: true, data: reviews });
    } catch (err) {
      console.error("[products] reviews error:", err);
      res.json({ success: true, data: [] });
    }
  });

  // ═════════════════════════════════════════════════════════════════════════
  // ADMIN PRODUCT MODERATION (VelCenter)
  // ═════════════════════════════════════════════════════════════════════════

  // Helper: verify user is an authorized admin (owner or admin)
  async function requireAdmin(req: Request, res: Response): Promise<boolean> {
    const userId = req.user!.userId;
    const userResult = await query("SELECT role FROM users WHERE id = $1", [userId]);
    if (userResult.rows.length === 0 || !["owner", "admin"].includes(userResult.rows[0].role)) {
      res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Only owner or admin can moderate products" } });
      return false;
    }
    return true;
  }

  // ── GET /api/admin/products/moderation ──────────────────────────────────
  // List products for moderation (all statuses). Used by VelCenter.
  app.get("/api/admin/products/moderation", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await requireAdmin(req, res))) return;

      const statusFilter = req.query.status as string | undefined;
      let where = "";
      const params: any[] = [];
      if (statusFilter && ["pending_review", "published", "rejected", "draft", "archived"].includes(statusFilter)) {
        where = "WHERE p.status = $1";
        params.push(statusFilter);
      }

      const result = await query(
        `SELECT p.id, p.name, p.description, p.short_description, p.price, p.compare_at_price,
                p.currency, p.unit, p.supplier, p.status, p.rejection_reason, p.category_id,
                p.shop_id, p.created_at, p.updated_at,
                sh.name as shop_name, sh.slug as shop_slug,
                u.id as seller_user_id, u.name as seller_name, u.email as seller_email,
                i.quantity as inventory_quantity, i.reserved as inventory_reserved,
                i.low_stock_threshold as inventory_reorder_level
         FROM products p
         JOIN shops sh ON p.shop_id = sh.id
         JOIN sellers s ON sh.seller_id = s.id
         JOIN users u ON s.user_id = u.id
         LEFT JOIN inventory i ON i.product_id = p.id
         ${where}
         ORDER BY p.created_at ASC`,
        params
      );

      const productIds = result.rows.map((r: any) => r.id);

      // Load images for all products
      let imagesByProduct = new Map<string, any[]>();
      if (productIds.length > 0) {
        const imagesResult = await query(
          `SELECT * FROM product_images WHERE product_id = ANY($1) ORDER BY sort_order ASC`,
          [productIds]
        );
        for (const img of imagesResult.rows) {
          const list = imagesByProduct.get(img.product_id) ?? [];
          list.push(img);
          imagesByProduct.set(img.product_id, list);
        }
      }

      const products = result.rows.map((row: any) => {
        const images = imagesByProduct.get(row.id) ?? [];
        const primaryImage = images.find((i: any) => i.sort_order === 0) ?? images[0] ?? null;
        return {
          id: row.id,
          name: row.name,
          description: row.description,
          short_description: row.short_description,
          price: row.price,
          compare_at_price: row.compare_at_price,
          currency: row.currency,
          unit: row.unit,
          supplier: row.supplier,
          status: row.status,
          rejection_reason: row.rejection_reason,
          category_id: row.category_id,
          shop_id: row.shop_id,
          shop_name: row.shop_name,
          shop_slug: row.shop_slug,
          seller_name: row.seller_name,
          seller_email: row.seller_email,
          created_at: row.created_at,
          updated_at: row.updated_at,
          inventory_quantity: row.inventory_quantity,
          inventory_reserved: row.inventory_reserved,
          inventory_reorder_level: row.inventory_reorder_level,
          primaryImage: primaryImage ? {
            id: primaryImage.id,
            url: primaryImage.url,
            alt: primaryImage.alt,
            sort_order: primaryImage.sort_order,
          } : null,
          images: images.map((img: any) => ({
            id: img.id,
            url: img.url,
            alt: img.alt,
            sort_order: img.sort_order,
          })),
        };
      });

      res.json({ success: true, data: products });
    } catch (err) {
      console.error("[admin] product moderation list error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to list products for moderation" } });
    }
  });

  // ── PATCH /api/admin/products/:productId/moderation ─────────────────────
  // Approve or reject a product. Admin only.
  app.patch("/api/admin/products/:productId/moderation", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await requireAdmin(req, res))) return;

      const productId = param(req, "productId");
      const { status, rejectionReason } = req.body;
      const userId = req.user!.userId;

      // Validate status
      const VALID_ADMIN_TRANSITIONS = ["published", "rejected"];
      if (!status || !VALID_ADMIN_TRANSITIONS.includes(status)) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: `Invalid status. Admin can set: ${VALID_ADMIN_TRANSITIONS.join(", ")}` } });
        return;
      }

      // Rejection requires a reason
      if (status === "rejected" && (!rejectionReason || typeof rejectionReason !== "string" || !rejectionReason.trim())) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Rejection reason is required" } });
        return;
      }

      // Fetch current product status
      const currentResult = await query("SELECT id, status FROM products WHERE id = $1", [productId]);
      if (currentResult.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Product not found" } });
        return;
      }

      const currentStatus = currentResult.rows[0].status;
      if (currentStatus !== "pending_review") {
        res.status(400).json({ success: false, error: { code: "INVALID_TRANSITION", message: `Cannot ${status} a product with status: ${currentStatus}. Only pending_review products can be moderated.` } });
        return;
      }

      // Update product status
      if (status === "rejected") {
        await query(
          "UPDATE products SET status = $1, rejection_reason = $2, updated_at = NOW() WHERE id = $3",
          [status, rejectionReason.trim(), productId]
        );
      } else {
        await query(
          "UPDATE products SET status = $1, rejection_reason = NULL, updated_at = NOW() WHERE id = $2",
          [status, productId]
        );
      }

      // Update shop product_count to reflect published products only
      const shopResult = await query("SELECT shop_id FROM products WHERE id = $1", [productId]);
      if (shopResult.rows[0]?.shop_id) {
        const countResult = await query(
          "SELECT COUNT(*) as cnt FROM products WHERE shop_id = $1 AND status = 'published'",
          [shopResult.rows[0].shop_id]
        );
        await query(
          "UPDATE shops SET product_count = $1, updated_at = NOW() WHERE id = $2",
          [parseInt(countResult.rows[0].cnt), shopResult.rows[0].shop_id]
        );
      }

      console.log(`[admin] product ${status}: ${productId} by admin ${userId} [${currentStatus} -> ${status}]`);


      // Write audit log + moderation record
      try {
        await query(
          `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
           VALUES ($1, 'product_moderation', 'product', $2, $3)`,
          [userId, productId, JSON.stringify({ from: currentStatus, to: status, rejectionReason: status === 'rejected' ? (rejectionReason ?? '').trim() : null })]
        );
        await query(
          `INSERT INTO moderation_records (moderator_id, entity_type, entity_id, action, reason)
           VALUES ($1, 'product', $2, $3, $4)`,
          [userId, productId, status, status === 'rejected' ? (rejectionReason ?? '').trim() : null]
        );
      } catch { /* audit is best-effort */ }
      // Return the full updated product with images
      const updatedResult = await query(
        `SELECT p.*, sh.name as shop_name, sh.slug as shop_slug,
                u.name as seller_name, u.email as seller_email,
                i.quantity as inventory_quantity, i.reserved as inventory_reserved,
                i.low_stock_threshold as inventory_reorder_level
         FROM products p
         JOIN shops sh ON p.shop_id = sh.id
         JOIN sellers s ON sh.seller_id = s.id
         JOIN users u ON s.user_id = u.id
         LEFT JOIN inventory i ON i.product_id = p.id
         WHERE p.id = $1`,
        [productId]
      );

      if (updatedResult.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Product not found after update" } });
        return;
      }

      const row = updatedResult.rows[0];
      const imagesResult = await query(
        "SELECT * FROM product_images WHERE product_id = $1 ORDER BY sort_order ASC",
        [productId]
      );
      const images = imagesResult.rows;
      const primaryImage = images.find((i: any) => i.sort_order === 0) ?? images[0] ?? null;

      res.json({
        success: true,
        data: {
          id: row.id,
          name: row.name,
          description: row.description,
          short_description: row.short_description,
          price: row.price,
          compare_at_price: row.compare_at_price,
          currency: row.currency,
          unit: row.unit,
          supplier: row.supplier,
          status: row.status,
          rejection_reason: row.rejection_reason,
          category_id: row.category_id,
          shop_id: row.shop_id,
          shop_name: row.shop_name,
          shop_slug: row.shop_slug,
          seller_name: row.seller_name,
          seller_email: row.seller_email,
          created_at: row.created_at,
          updated_at: row.updated_at,
          inventory_quantity: row.inventory_quantity,
          inventory_reserved: row.inventory_reserved,
          inventory_reorder_level: row.inventory_reorder_level,
          primaryImage: primaryImage ? {
            id: primaryImage.id,
            url: primaryImage.url,
            alt: primaryImage.alt,
            sort_order: primaryImage.sort_order,
          } : null,
          images: images.map((img: any) => ({
            id: img.id,
            url: img.url,
            alt: img.alt,
            sort_order: img.sort_order,
          })),
        },
      });
    } catch (err) {
      console.error("[admin] product moderation error:", err);
      res.status(500).json({ success: false, error: { code: "MODERATION_FAILED", message: "Failed to moderate product" } });
    }
  });
}
