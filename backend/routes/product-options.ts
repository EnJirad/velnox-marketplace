/**
 * Velnox Product Options & Attributes Routes
 *
 * Seller endpoints (requireAuth + ownership):
 *   GET    /api/seller/products/:productId/options              — Get all option groups + values
 *   POST   /api/seller/products/:productId/option-groups        — Create option group
 *   PATCH  /api/seller/products/:productId/option-groups/:groupId  — Update option group
 *   DELETE /api/seller/products/:productId/option-groups/:groupId  — Delete option group + values
 *   POST   /api/seller/products/:productId/option-groups/:groupId/values — Add option value
 *   DELETE /api/seller/products/:productId/option-values/:valueId    — Delete option value
 *   GET    /api/seller/products/:productId/attributes            — Get all attributes
 *   POST   /api/seller/products/:productId/attributes            — Add attribute
 *   DELETE /api/seller/products/:productId/attributes/:attrId     — Delete attribute
 *   POST   /api/seller/products/:productId/variants/generate     — Generate variants from option combinations
 *
 * Public endpoints:
 *   GET /api/products/:productId/options                         — Get option groups + values (published only)
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { query, getClient } from "../db/index.js";

// ─── Helpers ──────────────────────────────────────────────────────────────

function param(req: Request, key: string): string {
  const val = req.params[key] as string | string[] | undefined;
  if (Array.isArray(val)) return val[0] ?? "";
  return val ?? "";
}

async function getSellerForUser(userId: string): Promise<{ id: string; status: string } | null> {
  const r = await query("SELECT id, status FROM sellers WHERE user_id = $1", [userId]);
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

// ─── Route Registration ───────────────────────────────────────────────────

export function setupProductOptionRoutes(app: Express): void {

  // ═════════════════════════════════════════════════════════════════════════
  // PUBLIC ROUTES
  // ═════════════════════════════════════════════════════════════════════════

  // ── GET /api/products/:productId/options ─────────────────────────────────
  app.get("/api/products/:productId/options", async (req: Request, res: Response) => {
    try {
      const productId = param(req, "productId");

      // Only return for published products
      const productCheck = await query(
        "SELECT id FROM products WHERE id = $1 AND status = 'published'",
        [productId]
      );
      if (productCheck.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Product not found" } });
        return;
      }

      // Load option groups
      const groupsResult = await query(
        "SELECT * FROM product_option_groups WHERE product_id = $1 ORDER BY sort_order ASC",
        [productId]
      );

      const groups = [];
      for (const group of groupsResult.rows) {
        const valuesResult = await query(
          "SELECT * FROM product_option_values WHERE option_group_id = $1 ORDER BY sort_order ASC",
          [group.id]
        );
        groups.push({
          id: group.id,
          productId: group.product_id,
          name: group.name,
          displayType: group.display_type,
          required: group.required,
          sortOrder: group.sort_order,
          values: valuesResult.rows.map((v: any) => ({
            id: v.id,
            optionGroupId: v.option_group_id,
            value: v.value,
            label: v.label || v.value,
            imageUrl: v.image_url,
            sortOrder: v.sort_order,
          })),
        });
      }

      // Load attributes
      const attrsResult = await query(
        "SELECT * FROM product_attributes WHERE product_id = $1 ORDER BY sort_order ASC",
        [productId]
      );
      const attributes = attrsResult.rows.map((a: any) => ({
        id: a.id,
        productId: a.product_id,
        name: a.name,
        value: a.value,
        sortOrder: a.sort_order,
      }));

      // Load variant-to-option mapping
      const variantValuesResult = await query(
        `SELECT pvv.variant_id, pvv.option_value_id,
                pov.option_group_id, pov.value
         FROM product_variant_values pvv
         JOIN product_option_values pov ON pvv.option_value_id = pov.id
         JOIN product_variants pv ON pvv.variant_id = pv.id
         WHERE pv.product_id = $1`,
        [productId]
      );

      // Group by variant
      const variantOptions: Record<string, Record<string, string>> = {};
      for (const row of variantValuesResult.rows) {
        const vid = row.variant_id as string;
        const gid = row.option_group_id as string;
        if (!variantOptions[vid]) variantOptions[vid] = {};
        variantOptions[vid][gid] = row.value as string;
      }

      res.json({
        success: true,
        data: { optionGroups: groups, attributes, variantOptions },
      });
    } catch (err) {
      console.error("[product-options] get public options error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch options" } });
    }
  });

  // ═════════════════════════════════════════════════════════════════════════
  // SELLER ROUTES (authenticated, ownership verified)
  // ═════════════════════════════════════════════════════════════════════════

  // ── GET /api/seller/products/:productId/options ──────────────────────────
  app.get("/api/seller/products/:productId/options", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const seller = await getSellerForUser(userId);
      if (!seller) { res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not a seller" } }); return; }

      const productId = param(req, "productId");
      if (!(await verifyProductOwnership(productId, seller.id))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Product does not belong to this seller" } });
        return;
      }

      // Load option groups with values
      const groupsResult = await query(
        "SELECT * FROM product_option_groups WHERE product_id = $1 ORDER BY sort_order ASC",
        [productId]
      );

      const groups = [];
      for (const group of groupsResult.rows) {
        const valuesResult = await query(
          "SELECT * FROM product_option_values WHERE option_group_id = $1 ORDER BY sort_order ASC",
          [group.id]
        );
        groups.push({
          id: group.id,
          productId: group.product_id,
          name: group.name,
          displayType: group.display_type,
          required: group.required,
          sortOrder: group.sort_order,
          values: valuesResult.rows.map((v: any) => ({
            id: v.id,
            optionGroupId: v.option_group_id,
            value: v.value,
            label: v.label || v.value,
            imageUrl: v.image_url,
            sortOrder: v.sort_order,
          })),
        });
      }

      // Load attributes
      const attrsResult = await query(
        "SELECT * FROM product_attributes WHERE product_id = $1 ORDER BY sort_order ASC",
        [productId]
      );
      const attributes = attrsResult.rows.map((a: any) => ({
        id: a.id,
        productId: a.product_id,
        name: a.name,
        value: a.value,
        sortOrder: a.sort_order,
      }));

      res.json({
        success: true,
        data: { optionGroups: groups, attributes },
      });
    } catch (err) {
      console.error("[product-options] seller get options error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch options" } });
    }
  });

  // ── POST /api/seller/products/:productId/option-groups ───────────────────
  app.post("/api/seller/products/:productId/option-groups", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const seller = await getSellerForUser(userId);
      if (!seller) { res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not a seller" } }); return; }

      const productId = param(req, "productId");
      if (!(await verifyProductOwnership(productId, seller.id))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Product does not belong to this seller" } });
        return;
      }

      const { name, displayType = "text", required = true, sortOrder } = req.body;
      if (!name || typeof name !== "string" || !name.trim()) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Option group name is required" } });
        return;
      }

      const validDisplayTypes = ["text", "color", "image", "button"];
      const resolvedDisplayType = validDisplayTypes.includes(displayType) ? displayType : "text";

      // Get next sort_order
      const maxSort = await query(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 as next_sort FROM product_option_groups WHERE product_id = $1",
        [productId]
      );
      const resolvedSortOrder = sortOrder ?? maxSort.rows[0]?.next_sort ?? 0;

      const result = await query(
        `INSERT INTO product_option_groups (product_id, name, display_type, required, sort_order)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [productId, name.trim(), resolvedDisplayType, required, resolvedSortOrder]
      );

      const group = result.rows[0];
      console.log(`[product-options] created option group: ${group.id} (${group.name}) for product ${productId}`);

      res.json({
        success: true,
        data: {
          id: group.id,
          productId: group.product_id,
          name: group.name,
          displayType: group.display_type,
          required: group.required,
          sortOrder: group.sort_order,
          values: [],
        },
      });
    } catch (err) {
      console.error("[product-options] create group error:", err);
      res.status(500).json({ success: false, error: { code: "CREATE_FAILED", message: "Failed to create option group" } });
    }
  });

  // ── PATCH /api/seller/products/:productId/option-groups/:groupId ────────
  app.patch("/api/seller/products/:productId/option-groups/:groupId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const seller = await getSellerForUser(userId);
      if (!seller) { res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not a seller" } }); return; }

      const productId = param(req, "productId");
      const groupId = param(req, "groupId");
      if (!(await verifyProductOwnership(productId, seller.id))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Product does not belong to this seller" } });
        return;
      }

      // Verify group belongs to product
      const groupCheck = await query(
        "SELECT id FROM product_option_groups WHERE id = $1 AND product_id = $2",
        [groupId, productId]
      );
      if (groupCheck.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Option group not found" } });
        return;
      }

      const { name, displayType, required, sortOrder } = req.body;
      const updates: string[] = [];
      const values: any[] = [];
      let idx = 1;

      if (name !== undefined && typeof name === "string" && name.trim()) {
        updates.push(`name = $${idx++}`);
        values.push(name.trim());
      }
      if (displayType !== undefined) {
        const validDisplayTypes = ["text", "color", "image", "button"];
        if (validDisplayTypes.includes(displayType)) {
          updates.push(`display_type = $${idx++}`);
          values.push(displayType);
        }
      }
      if (required !== undefined) {
        updates.push(`required = $${idx++}`);
        values.push(!!required);
      }
      if (sortOrder !== undefined) {
        updates.push(`sort_order = $${idx++}`);
        values.push(Number(sortOrder));
      }

      if (updates.length === 0) {
        res.json({ success: true, data: null });
        return;
      }

      updates.push("updated_at = NOW()");
      values.push(groupId);

      await query(
        `UPDATE product_option_groups SET ${updates.join(", ")} WHERE id = $${idx}`,
        values
      );

      console.log(`[product-options] updated option group: ${groupId}`);

      res.json({ success: true, data: { id: groupId } });
    } catch (err) {
      console.error("[product-options] update group error:", err);
      res.status(500).json({ success: false, error: { code: "UPDATE_FAILED", message: "Failed to update option group" } });
    }
  });

  // ── DELETE /api/seller/products/:productId/option-groups/:groupId ───────
  app.delete("/api/seller/products/:productId/option-groups/:groupId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const seller = await getSellerForUser(userId);
      if (!seller) { res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not a seller" } }); return; }

      const productId = param(req, "productId");
      const groupId = param(req, "groupId");
      if (!(await verifyProductOwnership(productId, seller.id))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Product does not belong to this seller" } });
        return;
      }

      // Verify group belongs to product
      const groupCheck = await query(
        "SELECT id FROM product_option_groups WHERE id = $1 AND product_id = $2",
        [groupId, productId]
      );
      if (groupCheck.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Option group not found" } });
        return;
      }

      // CASCADE will delete option_values and variant_values
      await query("DELETE FROM product_option_groups WHERE id = $1", [groupId]);

      console.log(`[product-options] deleted option group: ${groupId} (product ${productId})`);

      res.json({ success: true, data: { id: groupId } });
    } catch (err) {
      console.error("[product-options] delete group error:", err);
      res.status(500).json({ success: false, error: { code: "DELETE_FAILED", message: "Failed to delete option group" } });
    }
  });

  // ── POST /api/seller/products/:productId/option-groups/:groupId/values ──
  app.post("/api/seller/products/:productId/option-groups/:groupId/values", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const seller = await getSellerForUser(userId);
      if (!seller) { res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not a seller" } }); return; }

      const productId = param(req, "productId");
      const groupId = param(req, "groupId");
      if (!(await verifyProductOwnership(productId, seller.id))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Product does not belong to this seller" } });
        return;
      }

      // Verify group belongs to product
      const groupCheck = await query(
        "SELECT id FROM product_option_groups WHERE id = $1 AND product_id = $2",
        [groupId, productId]
      );
      if (groupCheck.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Option group not found" } });
        return;
      }

      const { value, label, imageUrl, sortOrder } = req.body;
      if (!value || typeof value !== "string" || !value.trim()) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Option value is required" } });
        return;
      }

      // Get next sort_order
      const maxSort = await query(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 as next_sort FROM product_option_values WHERE option_group_id = $1",
        [groupId]
      );
      const resolvedSortOrder = sortOrder ?? maxSort.rows[0]?.next_sort ?? 0;

      const result = await query(
        `INSERT INTO product_option_values (option_group_id, value, label, image_url, sort_order)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [groupId, value.trim(), label || value.trim(), imageUrl || null, resolvedSortOrder]
      );

      const val = result.rows[0];
      console.log(`[product-options] added option value: ${val.id} (${val.value}) to group ${groupId}`);

      res.json({
        success: true,
        data: {
          id: val.id,
          optionGroupId: val.option_group_id,
          value: val.value,
          label: val.label || val.value,
          imageUrl: val.image_url,
          sortOrder: val.sort_order,
        },
      });
    } catch (err) {
      console.error("[product-options] add value error:", err);
      res.status(500).json({ success: false, error: { code: "CREATE_FAILED", message: "Failed to add option value" } });
    }
  });

  // ── DELETE /api/seller/products/:productId/option-values/:valueId ────────
  app.delete("/api/seller/products/:productId/option-values/:valueId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const seller = await getSellerForUser(userId);
      if (!seller) { res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not a seller" } }); return; }

      const productId = param(req, "productId");
      const valueId = param(req, "valueId");
      if (!(await verifyProductOwnership(productId, seller.id))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Product does not belong to this seller" } });
        return;
      }

      // Verify value belongs to a group that belongs to the product
      const valueCheck = await query(
        `SELECT pov.id FROM product_option_values pov
         JOIN product_option_groups pog ON pov.option_group_id = pog.id
         WHERE pov.id = $1 AND pog.product_id = $2`,
        [valueId, productId]
      );
      if (valueCheck.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Option value not found" } });
        return;
      }

      // CASCADE will delete product_variant_values referencing this
      await query("DELETE FROM product_option_values WHERE id = $1", [valueId]);

      console.log(`[product-options] deleted option value: ${valueId}`);

      res.json({ success: true, data: { id: valueId } });
    } catch (err) {
      console.error("[product-options] delete value error:", err);
      res.status(500).json({ success: false, error: { code: "DELETE_FAILED", message: "Failed to delete option value" } });
    }
  });

  // ── POST /api/seller/products/:productId/variants/generate ──────────────
  // Generate variant combinations from option groups
  app.post("/api/seller/products/:productId/variants/generate", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const seller = await getSellerForUser(userId);
      if (!seller) { res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not a seller" } }); return; }

      const productId = param(req, "productId");
      if (!(await verifyProductOwnership(productId, seller.id))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Product does not belong to this seller" } });
        return;
      }

      // Load option groups with values
      const groupsResult = await query(
        "SELECT * FROM product_option_groups WHERE product_id = $1 AND required = true ORDER BY sort_order ASC",
        [productId]
      );

      if (groupsResult.rows.length === 0) {
        res.status(400).json({ success: false, error: { code: "NO_OPTIONS", message: "No option groups found for this product" } });
        return;
      }

      // Load values for each group
      const groupValues: { groupId: string; groupName: string; values: { id: string; value: string }[] }[] = [];
      for (const group of groupsResult.rows) {
        const valuesResult = await query(
          "SELECT id, value FROM product_option_values WHERE option_group_id = $1 ORDER BY sort_order ASC",
          [group.id]
        );
        groupValues.push({
          groupId: group.id,
          groupName: group.name,
          values: valuesResult.rows.map((v: any) => ({ id: v.id, value: v.value })),
        });
      }

      // Generate cartesian product of all option values
      function cartesianProduct(arrays: { id: string; value: string }[][]): { id: string; value: string }[][] {
        if (arrays.length === 0) return [[]];
        const [first, ...rest] = arrays;
        if (!first) return [[]];
        const restProduct = cartesianProduct(rest);
        return first.flatMap((item: { id: string; value: string }) =>
          restProduct.map((combo: { id: string; value: string }[]) => [item, ...combo])
        );
      }

      const combinations = cartesianProduct(groupValues.map((g) => g.values));

      // Cap at 100 variants to prevent explosion
      if (combinations.length > 100) {
        res.status(400).json({
          success: false,
          error: { code: "TOO_MANY_VARIANTS", message: `Cannot generate ${combinations.length} variants (max 100). Reduce option values.` },
        });
        return;
      }

      // Get product's default price and stock
      const productResult = await query("SELECT price FROM products WHERE id = $1", [productId]);
      const defaultPrice = productResult.rows[0]?.price ?? 0;

      const client = await getClient();
      const createdVariants = [];

      try {
        await client.query("BEGIN");

        for (let i = 0; i < combinations.length; i++) {
          const combo = combinations[i];
          if (!combo) continue;

          // Create variant name from combination
          const variantName = combo.map((c: { id: string; value: string }) => c.value).join(" / ");

          // Create the variant
          const variantResult = await client.query(
            `INSERT INTO product_variants (product_id, name, sku, price, stock, status, sort_order)
             VALUES ($1, $2, $3, $4, $5, 'active', $6)
             RETURNING *`,
            [productId, variantName, null, defaultPrice, 0, i]
          );
          const variant = variantResult.rows[0];

          // Link variant to option values
          for (const optVal of combo) {
            await client.query(
              `INSERT INTO product_variant_values (variant_id, option_value_id)
               VALUES ($1, $2)`,
              [variant.id, optVal.id]
            );
          }

          createdVariants.push({
            id: variant.id,
            productId: variant.product_id,
            name: variant.name,
            sku: variant.sku,
            price: parseFloat(variant.price),
            stock: variant.stock,
            status: variant.status,
            sortOrder: variant.sort_order,
            options: combo.reduce((acc: Record<string, string>, c: { id: string; value: string }, idx: number) => {
              const gv = groupValues[idx];
              if (gv) acc[gv.groupName] = c.value;
              return acc;
            }, {} as Record<string, string>),
          });
        }

        await client.query("COMMIT");
      } catch (txErr) {
        await client.query("ROLLBACK").catch(() => {});
        throw txErr;
      } finally {
        client.release();
      }

      console.log(`[product-options] generated ${createdVariants.length} variants for product ${productId}`);

      res.json({
        success: true,
        data: { variants: createdVariants },
      });
    } catch (err) {
      console.error("[product-options] generate variants error:", err);
      res.status(500).json({ success: false, error: { code: "GENERATE_FAILED", message: "Failed to generate variants" } });
    }
  });

  // ── GET /api/seller/products/:productId/attributes ──────────────────────
  app.get("/api/seller/products/:productId/attributes", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const seller = await getSellerForUser(userId);
      if (!seller) { res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not a seller" } }); return; }

      const productId = param(req, "productId");
      if (!(await verifyProductOwnership(productId, seller.id))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Product does not belong to this seller" } });
        return;
      }

      const result = await query(
        "SELECT * FROM product_attributes WHERE product_id = $1 ORDER BY sort_order ASC",
        [productId]
      );

      const attributes = result.rows.map((a: any) => ({
        id: a.id,
        productId: a.product_id,
        name: a.name,
        value: a.value,
        sortOrder: a.sort_order,
      }));

      res.json({ success: true, data: attributes });
    } catch (err) {
      console.error("[product-options] get attributes error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch attributes" } });
    }
  });

  // ── POST /api/seller/products/:productId/attributes ─────────────────────
  app.post("/api/seller/products/:productId/attributes", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const seller = await getSellerForUser(userId);
      if (!seller) { res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not a seller" } }); return; }

      const productId = param(req, "productId");
      if (!(await verifyProductOwnership(productId, seller.id))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Product does not belong to this seller" } });
        return;
      }

      const { name, value, sortOrder } = req.body;
      if (!name || typeof name !== "string" || !name.trim()) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Attribute name is required" } });
        return;
      }
      if (!value || typeof value !== "string" || !value.trim()) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Attribute value is required" } });
        return;
      }

      // Get next sort_order
      const maxSort = await query(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 as next_sort FROM product_attributes WHERE product_id = $1",
        [productId]
      );
      const resolvedSortOrder = sortOrder ?? maxSort.rows[0]?.next_sort ?? 0;

      const result = await query(
        `INSERT INTO product_attributes (product_id, name, value, sort_order)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [productId, name.trim(), value.trim(), resolvedSortOrder]
      );

      const attr = result.rows[0];
      console.log(`[product-options] added attribute: ${attr.id} (${attr.name}: ${attr.value}) for product ${productId}`);

      res.json({
        success: true,
        data: {
          id: attr.id,
          productId: attr.product_id,
          name: attr.name,
          value: attr.value,
          sortOrder: attr.sort_order,
        },
      });
    } catch (err) {
      console.error("[product-options] add attribute error:", err);
      res.status(500).json({ success: false, error: { code: "CREATE_FAILED", message: "Failed to add attribute" } });
    }
  });

  // ── DELETE /api/seller/products/:productId/attributes/:attrId ───────────
  app.delete("/api/seller/products/:productId/attributes/:attrId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const seller = await getSellerForUser(userId);
      if (!seller) { res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not a seller" } }); return; }

      const productId = param(req, "productId");
      const attrId = param(req, "attrId");
      if (!(await verifyProductOwnership(productId, seller.id))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Product does not belong to this seller" } });
        return;
      }

      // Verify attribute belongs to product
      const attrCheck = await query(
        "SELECT id FROM product_attributes WHERE id = $1 AND product_id = $2",
        [attrId, productId]
      );
      if (attrCheck.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Attribute not found" } });
        return;
      }

      await query("DELETE FROM product_attributes WHERE id = $1", [attrId]);

      console.log(`[product-options] deleted attribute: ${attrId}`);

      res.json({ success: true, data: { id: attrId } });
    } catch (err) {
      console.error("[product-options] delete attribute error:", err);
      res.status(500).json({ success: false, error: { code: "DELETE_FAILED", message: "Failed to delete attribute" } });
    }
  });

  // ── GET /api/seller/products/:productId/variants ─────────────────────────
  // List all variants with their option labels
  app.get("/api/seller/products/:productId/variants", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const seller = await getSellerForUser(userId);
      if (!seller) { res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not a seller" } }); return; }

      const productId = param(req, "productId");
      if (!(await verifyProductOwnership(productId, seller.id))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Product does not belong to this seller" } });
        return;
      }

      const result = await query(
        `SELECT pv.*,
                COALESCE(
                  (SELECT string_agg(pov.label || ' / ' || pog.name, ', ' ORDER BY pog.sort_order)
                   FROM product_variant_values pvv
                   JOIN product_option_values pov ON pvv.option_value_id = pov.id
                   JOIN product_option_groups pog ON pov.option_group_id = pog.id
                   WHERE pvv.variant_id = pv.id),
                  ''
                ) AS option_labels
         FROM product_variants pv
         WHERE pv.product_id = $1
         ORDER BY pv.sort_order ASC, pv.name ASC`,
        [productId]
      );

      const variants = result.rows.map((v: any) => ({
        id: v.id,
        productId: v.product_id,
        name: v.name,
        sku: v.sku,
        price: parseFloat(v.price) || 0,
        stock: v.stock ?? 0,
        status: v.status || "active",
        sortOrder: v.sort_order ?? 0,
        optionLabels: v.option_labels || "",
        createdAt: v.created_at ? new Date(v.created_at).getTime() : Date.now(),
      }));

      console.log(`[product-options] seller variants: product=${productId} count=${variants.length}`);
      res.json({ success: true, data: variants });
    } catch (err) {
      console.error("[product-options] list variants error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch variants" } });
    }
  });

  // ── PATCH /api/seller/products/:productId/variants/:variantId ────────────
  // Update variant price, stock, sku, status
  app.patch("/api/seller/products/:productId/variants/:variantId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const seller = await getSellerForUser(userId);
      if (!seller) { res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not a seller" } }); return; }

      const productId = param(req, "productId");
      const variantId = param(req, "variantId");
      if (!(await verifyProductOwnership(productId, seller.id))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Product does not belong to this seller" } });
        return;
      }

      const variantCheck = await query(
        "SELECT id FROM product_variants WHERE id = $1 AND product_id = $2",
        [variantId, productId]
      );
      if (variantCheck.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Variant not found" } });
        return;
      }

      const { price, stock, sku, status, sortOrder } = req.body;
      const updates: string[] = [];
      const values: any[] = [];
      let idx = 1;

      if (price !== undefined) {
        const priceNum = Number(price);
        if (!Number.isFinite(priceNum) || priceNum < 0) {
          res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid price" } });
          return;
        }
        updates.push(`price = $${idx++}`);
        values.push(priceNum);
      }
      if (stock !== undefined) {
        const stockNum = Number(stock);
        if (!Number.isFinite(stockNum) || stockNum < 0) {
          res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid stock" } });
          return;
        }
        updates.push(`stock = $${idx++}`);
        values.push(Math.floor(stockNum));
      }
      if (sku !== undefined) {
        updates.push(`sku = $${idx++}`);
        values.push(sku || null);
      }
      if (status !== undefined) {
        const validStatuses = ["active", "inactive", "archived"];
        if (!validStatuses.includes(status)) {
          res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: `Invalid status. Must be one of: ${validStatuses.join(", ")}` } });
          return;
        }
        updates.push(`status = $${idx++}`);
        values.push(status);
      }
      if (sortOrder !== undefined) {
        updates.push(`sort_order = $${idx++}`);
        values.push(Number(sortOrder));
      }

      if (updates.length === 0) {
        res.json({ success: true, data: { id: variantId } });
        return;
      }

      updates.push("updated_at = NOW()");
      values.push(variantId);

      await query(
        `UPDATE product_variants SET ${updates.join(", ")} WHERE id = $${idx}`,
        values
      );

      console.log(`[product-options] updated variant: ${variantId} fields: ${updates.slice(0, -1).join(", ")}`);
      res.json({ success: true, data: { id: variantId } });
    } catch (err) {
      console.error("[product-options] update variant error:", err);
      res.status(500).json({ success: false, error: { code: "UPDATE_FAILED", message: "Failed to update variant" } });
    }
  });

  // ── DELETE /api/seller/products/:productId/variants/:variantId ───────────
  app.delete("/api/seller/products/:productId/variants/:variantId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const seller = await getSellerForUser(userId);
      if (!seller) { res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not a seller" } }); return; }

      const productId = param(req, "productId");
      const variantId = param(req, "variantId");
      if (!(await verifyProductOwnership(productId, seller.id))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Product does not belong to this seller" } });
        return;
      }

      await query("DELETE FROM product_variants WHERE id = $1 AND product_id = $2", [variantId, productId]);

      console.log(`[product-options] deleted variant: ${variantId} (product ${productId})`);
      res.json({ success: true, data: { id: variantId } });
    } catch (err) {
      console.error("[product-options] delete variant error:", err);
      res.status(500).json({ success: false, error: { code: "DELETE_FAILED", message: "Failed to delete variant" } });
    }
  });

  // ── PATCH /api/seller/products/:productId/option-values/:valueId ─────────
  // Update option value (label, image_url)
  app.patch("/api/seller/products/:productId/option-values/:valueId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const seller = await getSellerForUser(userId);
      if (!seller) { res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not a seller" } }); return; }

      const productId = param(req, "productId");
      const valueId = param(req, "valueId");
      if (!(await verifyProductOwnership(productId, seller.id))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Product does not belong to this seller" } });
        return;
      }

      const valueCheck = await query(
        `SELECT pov.id FROM product_option_values pov
         JOIN product_option_groups pog ON pov.option_group_id = pog.id
         WHERE pov.id = $1 AND pog.product_id = $2`,
        [valueId, productId]
      );
      if (valueCheck.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Option value not found" } });
        return;
      }

      const { label, imageUrl } = req.body;
      const updates: string[] = [];
      const values: any[] = [];
      let idx = 1;

      if (label !== undefined) {
        updates.push(`label = $${idx++}`);
        values.push(label || "");
      }
      if (imageUrl !== undefined) {
        updates.push(`image_url = $${idx++}`);
        values.push(imageUrl || null);
      }

      if (updates.length === 0) {
        res.json({ success: true, data: { id: valueId } });
        return;
      }

      values.push(valueId);
      await query(
        `UPDATE product_option_values SET ${updates.join(", ")} WHERE id = $${idx}`,
        values
      );

      console.log(`[product-options] updated option value: ${valueId}`);
      res.json({ success: true, data: { id: valueId } });
    } catch (err) {
      console.error("[product-options] update option value error:", err);
      res.status(500).json({ success: false, error: { code: "UPDATE_FAILED", message: "Failed to update option value" } });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // VARIANT IMAGE ROUTES
  // ═══════════════════════════════════════════════════════════════════════

  // ── GET /api/seller/products/:productId/variants/:variantId/images ────
  app.get("/api/seller/products/:productId/variants/:variantId/images", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const seller = await getSellerForUser(userId);
      if (!seller) { res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not a seller" } }); return; }

      const productId = param(req, "productId");
      const variantId = param(req, "variantId");
      if (!(await verifyProductOwnership(productId, seller.id))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Product does not belong to this seller" } }); return;
      }

      // Verify variant exists and belongs to product
      const variantCheck = await query("SELECT id FROM product_variants WHERE id = $1 AND product_id = $2", [variantId, productId]);
      if (variantCheck.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Variant not found" } }); return;
      }

      const result = await query(
        "SELECT * FROM product_variant_images WHERE variant_id = $1 ORDER BY sort_order ASC",
        [variantId]
      );

      const images = result.rows.map((r: any) => ({
        id: r.id,
        variantId: r.variant_id,
        productId: r.product_id,
        url: r.url,
        alt: r.alt || '',
        storageKey: r.storage_key || null,
        sortOrder: r.sort_order ?? 0,
      }));

      res.json({ success: true, data: images });
    } catch (err) {
      console.error("[product-options] list variant images error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch variant images" } });
    }
  });

  // ── POST /api/seller/products/:productId/variants/:variantId/images ────
  app.post("/api/seller/products/:productId/variants/:variantId/images", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const seller = await getSellerForUser(userId);
      if (!seller) { res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not a seller" } }); return; }

      const productId = param(req, "productId");
      const variantId = param(req, "variantId");
      if (!(await verifyProductOwnership(productId, seller.id))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Product does not belong to this seller" } }); return;
      }

      // Verify variant belongs to product
      const variantCheck = await query("SELECT id FROM product_variants WHERE id = $1 AND product_id = $2", [variantId, productId]);
      if (variantCheck.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Variant not found" } }); return;
      }

      const { url, alt, storageKey, sortOrder } = req.body;
      if (!url || typeof url !== "string" || !url.trim()) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Image URL is required" } }); return;
      }

      const maxSort = await query(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 as next_sort FROM product_variant_images WHERE variant_id = $1",
        [variantId]
      );
      const resolvedSortOrder = sortOrder ?? maxSort.rows[0]?.next_sort ?? 0;

      const result = await query(
        `INSERT INTO product_variant_images (variant_id, product_id, url, alt, storage_key, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [variantId, productId, url.trim(), alt || '', storageKey || null, resolvedSortOrder]
      );

      const img = result.rows[0];
      console.log(`[product-options] added variant image: ${img.id} for variant ${variantId}`);

      res.json({
        success: true,
        data: {
          id: img.id,
          variantId: img.variant_id,
          productId: img.product_id,
          url: img.url,
          alt: img.alt || '',
          storageKey: img.storage_key || null,
          sortOrder: img.sort_order ?? 0,
        },
      });
    } catch (err) {
      console.error("[product-options] add variant image error:", err);
      res.status(500).json({ success: false, error: { code: "CREATE_FAILED", message: "Failed to add variant image" } });
    }
  });

  // ── DELETE /api/seller/products/:productId/variant-images/:imageId ──────
  app.delete("/api/seller/products/:productId/variant-images/:imageId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const seller = await getSellerForUser(userId);
      if (!seller) { res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not a seller" } }); return; }

      const productId = param(req, "productId");
      const imageId = param(req, "imageId");
      if (!(await verifyProductOwnership(productId, seller.id))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Product does not belong to this seller" } }); return;
      }

      // Verify image belongs to product's variant
      const imgCheck = await query(
        `SELECT pvi.id FROM product_variant_images pvi
         WHERE pvi.id = $1 AND pvi.product_id = $2`,
        [imageId, productId]
      );
      if (imgCheck.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Variant image not found" } }); return;
      }

      await query("DELETE FROM product_variant_images WHERE id = $1", [imageId]);

      console.log(`[product-options] deleted variant image: ${imageId}`);
      res.json({ success: true, data: { id: imageId } });
    } catch (err) {
      console.error("[product-options] delete variant image error:", err);
      res.status(500).json({ success: false, error: { code: "DELETE_FAILED", message: "Failed to delete variant image" } });
    }
  });
}
