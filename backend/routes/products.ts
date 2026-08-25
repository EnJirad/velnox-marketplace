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
 * Format a product row from the DB into the StoreProduct shape expected by the frontend.
 */
function formatProduct(row: Record<string, any>, images: any[], inventory: any): any {
  const primaryImage = images.find((img: any) => img.sort_order === 0) ?? images[0] ?? null;

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
    images: images.map((img: any) => ({
      id: img.id,
      productId: img.product_id,
      url: img.url,
      displayUrl: img.url,
      thumbUrl: img.url,
      storageProvider: "r2",
      storageKey: img.url,
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
    soldCount: row.sold_count ?? 0,
    rating: row.rating ? parseFloat(row.rating) : null,
    reviewCount: row.review_count ?? 0,
  };
}

/**
 * Load all images and inventory for a list of product IDs in bulk.
 */
async function loadProductExtras(productIds: string[]): Promise<{
  imagesByProduct: Map<string, any[]>;
  inventoryByProduct: Map<string, any>;
}> {
  if (productIds.length === 0) {
    return { imagesByProduct: new Map(), inventoryByProduct: new Map() };
  }

  const imagesResult = await query(
    `SELECT * FROM product_images WHERE product_id = ANY($1) ORDER BY sort_order ASC`,
    [productIds]
  );
  const inventoryResult = await query(
    `SELECT * FROM inventory WHERE product_id = ANY($1)`,
    [productIds]
  );

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

  return { imagesByProduct, inventoryByProduct };
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
      const { imagesByProduct, inventoryByProduct } = await loadProductExtras(productIds);

      const products = result.rows.map((row: any) =>
        formatProduct(
          { ...row, seller_id: seller.id },
          imagesByProduct.get(row.id) ?? [],
          inventoryByProduct.get(row.id) ?? null
        )
      );

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
            category || null,
          ]
        );

        const product = insertResult.rows[0];

        await client.query(
          `INSERT INTO inventory (product_id, quantity, reserved, low_stock_threshold)
           VALUES ($1, $2, 0, $3)`,
          [product.id, stockQty, reorder]
        );

        await client.query("UPDATE shops SET product_count = product_count + 1, updated_at = NOW() WHERE id = $1", [shop.id]);

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
      if (category !== undefined) { updates.push(`category_id = $${idx++}`); values.push(category); }
      if (status !== undefined) {
        const validStatuses = ["draft", "published", "pending_review", "rejected", "archived"];
        if (validStatuses.includes(status)) {
          updates.push(`status = $${idx++}`); values.push(status);
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
      const { imagesByProduct, inventoryByProduct } = await loadProductExtras([productId]);

      const formatted = formatProduct(
        { ...row, seller_id: seller.id },
        imagesByProduct.get(productId) ?? [],
        inventoryByProduct.get(productId) ?? null
      );

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
        if (img.url) deleteR2Object(img.url);
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
      const validStatuses = ["draft", "published", "pending_review", "rejected", "archived"];
      if (!status || !validStatuses.includes(status)) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: `Invalid status. Must be one of: ${validStatuses.join(", ")}` } });
        return;
      }

      const result = await query(
        "UPDATE products SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
        [status, productId]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Product not found" } });
        return;
      }

      const row = result.rows[0];
      const { imagesByProduct, inventoryByProduct } = await loadProductExtras([productId]);

      const formatted = formatProduct(
        { ...row, seller_id: seller.id },
        imagesByProduct.get(productId) ?? [],
        inventoryByProduct.get(productId) ?? null
      );

      console.log(`[products] status changed: ${productId} → ${status} by seller ${seller.id}`);

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

      console.log(`[products] stock set: ${productId} → ${qty} by seller ${seller.id}`);

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

      console.log(`[products] reorder level set: ${productId} → ${rl} by seller ${seller.id}`);

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

      res.json({
        success: true,
        data: {
          id: result.rows[0].id,
          url,
          alt: alt || "",
          sortOrder,
        },
      });
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

      // Get the image and verify ownership through product → shop → seller
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
      if (img.url) deleteR2Object(img.url);

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

      res.json({ success: true, data: { id: imageId } });
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

      res.json({ success: true, data: { productId, primaryImageId: imageId } });
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

      const { imageIds } = req.body;
      if (!Array.isArray(imageIds) || imageIds.length === 0) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "imageIds array required" } });
        return;
      }

      for (let i = 0; i < imageIds.length; i++) {
        await query(
          "UPDATE product_images SET sort_order = $1 WHERE id = $2 AND product_id = $3",
          [i, imageIds[i], productId]
        );
      }

      console.log(`[products] images reordered: ${productId} (${imageIds.length} images) by seller ${seller.id}`);

      res.json({ success: true, data: { productId, imageIds } });
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
      const { imagesByProduct, inventoryByProduct } = await loadProductExtras(productIds);

      const products = result.rows.map((row: any) =>
        formatProduct(row, imagesByProduct.get(row.id) ?? [], inventoryByProduct.get(row.id) ?? null)
      );

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
      const result = await query(
        `SELECT p.*, sh.name as shop_name, sh.slug as shop_slug, sh.seller_id
         FROM products p
         JOIN shops sh ON p.shop_id = sh.id
         WHERE p.id = $1`,
        [productId]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Product not found" } });
        return;
      }

      const row = result.rows[0];
      const { imagesByProduct, inventoryByProduct } = await loadProductExtras([productId]);

      const formatted = formatProduct(
        row,
        imagesByProduct.get(productId) ?? [],
        inventoryByProduct.get(productId) ?? null
      );

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
      const result = await query(
        `SELECT sh.*, s.status as seller_status
         FROM shops sh
         JOIN sellers s ON sh.seller_id = s.id
         WHERE (sh.id = $1 OR sh.slug = $1) AND s.status = 'approved'`,
        [shopId]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Shop not found" } });
        return;
      }

      const row = result.rows[0];
      const shop = {
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
      };

      res.json({ success: true, data: shop });
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
}
