import type { IDatabaseClient } from "../../core/database/db-client.js";
import type {
  ApplySellerInput,
  CreateProductInput,
  SellerProfileRecord,
  ShopRecord,
  UpdateProductInput,
  UpdateShopInput,
  VerificationStatus,
} from "./types.js";
import type { ProductDetailRecord, ProductRecord, ProductVariantRecord } from "../catalog/types.js";

export interface ISellerRepository {
  getSellerByUserId(userId: string): Promise<SellerProfileRecord | null>;
  getShopBySellerId(sellerId: string): Promise<ShopRecord | null>;
  createSellerAndShop(userId: string, input: ApplySellerInput): Promise<{ seller: SellerProfileRecord; shop: ShopRecord }>;
  updateShop(shopId: string, input: UpdateShopInput): Promise<ShopRecord>;
  createProduct(shopId: string, input: CreateProductInput): Promise<ProductDetailRecord>;
  updateProduct(productId: string, input: UpdateProductInput): Promise<ProductRecord>;
  deleteProduct(productId: string): Promise<boolean>;
  getProductById(productId: string): Promise<ProductDetailRecord | null>;
}

export class NeonSellerRepository implements ISellerRepository {
  constructor(private readonly db: IDatabaseClient) {}

  async getSellerByUserId(userId: string): Promise<SellerProfileRecord | null> {
    const res = await this.db.query<any>(
      `SELECT s.id, s.user_id as "userId", s.status, s.verification_status as "verificationStatus",
              s.verified_at as "verifiedAt", s.created_at as "createdAt", s.updated_at as "updatedAt",
              ss.settings as "sellerSettings"
       FROM sellers s
       LEFT JOIN seller_settings ss ON ss.seller_id = s.id
       WHERE s.user_id = $1`,
      [userId],
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    const settings = typeof r.sellerSettings === "object" && r.sellerSettings !== null ? r.sellerSettings : {};
    return {
      id: r.id,
      userId: r.userId,
      businessName: settings.businessName || settings.shopName || "Seller Store",
      businessType: settings.businessType || "individual",
      taxId: settings.taxId || null,
      idCardNumber: settings.idNumber || settings.idCardNumber || null,
      verificationStatus: r.verificationStatus || "unverified",
      status: r.status || "pending",
      verificationRejectedReason: settings.rejectionReason || null,
      verifiedAt: r.verifiedAt || null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  async getShopBySellerId(sellerId: string): Promise<ShopRecord | null> {
    const res = await this.db.query<any>(
      `SELECT id, seller_id as "sellerId", name, slug, description, category,
              logo as "logoUrl", cover as "coverUrl", status, rating,
              product_count as "reviewCount", phone,
              address_line1 as "line1", subdistrict, district, city, postal_code as "postalCode", country,
              created_at as "createdAt", updated_at as "updatedAt"
       FROM shops WHERE seller_id = $1`,
      [sellerId],
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      sellerId: r.sellerId,
      name: r.name,
      slug: r.slug,
      description: r.description || "",
      category: r.category || null,
      phone: r.phone || null,
      address: {
        line1: r.line1 || null,
        subdistrict: r.subdistrict || null,
        district: r.district || null,
        city: r.city || null,
        postalCode: r.postalCode || null,
        country: r.country || "TH",
      },
      logoUrl: r.logoUrl || null,
      coverUrl: r.coverUrl || null,
      status: r.status || "active",
      rating: Number(r.rating || 0),
      reviewCount: Number(r.reviewCount || 0),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  async createSellerAndShop(
    userId: string,
    input: ApplySellerInput,
  ): Promise<{ seller: SellerProfileRecord; shop: ShopRecord }> {
    return this.db.transaction(async (tx: IDatabaseClient) => {
      const now = new Date().toISOString();

      // Check if seller row already exists for this user
      const existingSellerRes = await tx.query<any>(
        `SELECT id, status, verification_status FROM sellers WHERE user_id = $1`,
        [userId],
      );

      let sellerId: string;
      let previousStatus = "none";
      const hasEvidence = Boolean(
        input.idCardFrontUrl ||
        input.idCardBackUrl ||
        input.selfieUrl ||
        (Array.isArray(input.identityEvidence) && input.identityEvidence.length > 0)
      );
      const verificationStatus: VerificationStatus = hasEvidence ? "pending" : "unverified";
      const sellerStatus = "pending";

      if (existingSellerRes.rows.length > 0) {
        sellerId = existingSellerRes.rows[0].id;
        previousStatus = existingSellerRes.rows[0].status || "none";
        await tx.query(
          `UPDATE sellers SET status = $1, verification_status = $2, updated_at = $3 WHERE id = $4`,
          [sellerStatus, verificationStatus, now, sellerId],
        );
      } else {
        sellerId = crypto.randomUUID();
        await tx.query(
          `INSERT INTO sellers (id, user_id, status, verification_status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $5)`,
          [sellerId, userId, sellerStatus, verificationStatus, now],
        );
      }

      // Upsert shop
      const shopAddr = input.shopAddress || {};
      const shopName = input.shopName.trim();
      const shopCategory = input.shopCategory?.trim() || null;
      const shopDescription = input.shopDescription?.trim() || "";
      const shopPhone = input.phone?.trim() || null;

      let baseSlug = (input.shopSlug?.trim() || shopName)
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .substring(0, 100);
      if (!baseSlug) baseSlug = `shop-${Date.now()}`;

      const existingShopRes = await tx.query<any>(
        `SELECT id, slug FROM shops WHERE seller_id = $1`,
        [sellerId],
      );

      let shopId: string;
      let slug = baseSlug;

      if (existingShopRes.rows.length > 0) {
        shopId = existingShopRes.rows[0].id;
        slug = existingShopRes.rows[0].slug || baseSlug;
        await tx.query(
          `UPDATE shops
           SET name = $1, description = $2, category = $3,
               address_line1 = $4, subdistrict = $5, district = $6,
               city = $7, postal_code = $8, country = $9, phone = $10,
               updated_at = $11
           WHERE id = $12`,
          [
            shopName,
            shopDescription,
            shopCategory,
            shopAddr.line1?.trim() || null,
            shopAddr.subdistrict?.trim() || null,
            shopAddr.district?.trim() || null,
            shopAddr.city?.trim() || null,
            shopAddr.postalCode?.trim() || null,
            shopAddr.country?.trim() || "TH",
            shopPhone,
            now,
            shopId,
          ],
        );
      } else {
        shopId = crypto.randomUUID();
        let finalSlug = slug;
        let suffix = 1;
        while (true) {
          const slugConflict = await tx.query<any>(
            `SELECT id FROM shops WHERE slug = $1`,
            [finalSlug],
          );
          if (slugConflict.rows.length === 0) break;
          finalSlug = `${slug}-${suffix++}`;
        }
        slug = finalSlug;

        await tx.query(
          `INSERT INTO shops (id, seller_id, name, slug, description, category,
                              address_line1, subdistrict, district, city, postal_code,
                              country, phone, status, rating, product_count, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'active', 0.0, 0, $14, $14)`,
          [
            shopId,
            sellerId,
            shopName,
            slug,
            shopDescription,
            shopCategory,
            shopAddr.line1?.trim() || null,
            shopAddr.subdistrict?.trim() || null,
            shopAddr.district?.trim() || null,
            shopAddr.city?.trim() || null,
            shopAddr.postalCode?.trim() || null,
            shopAddr.country?.trim() || "TH",
            shopPhone,
            now,
          ],
        );
      }

      // Persist applicant info + documents in seller_settings
      const settingsPayload: Record<string, unknown> = {
        shopName,
        businessName: input.businessName || shopName,
        businessType: input.businessType || "individual",
        firstName: input.firstName?.trim() || null,
        lastName: input.lastName?.trim() || null,
        phone: shopPhone,
        idNumber: input.idNumber?.trim() || input.idCardNumber?.trim() || null,
        idCardFrontUrl: input.idCardFrontUrl || null,
        idCardBackUrl: input.idCardBackUrl || null,
        selfieUrl: input.selfieUrl || null,
        identityEvidence: input.identityEvidence || [],
        submittedAt: now,
      };

      await tx.query(
        `INSERT INTO seller_settings (seller_id, settings, updated_at)
         VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (seller_id)
         DO UPDATE SET settings = COALESCE(seller_settings.settings, '{}'::jsonb) || $2::jsonb, updated_at = $3`,
        [sellerId, JSON.stringify(settingsPayload), now],
      );

      // Record seller verification submission with evidence if provided
      const evidenceList: string[] = [];
      if (input.idCardFrontUrl) evidenceList.push(input.idCardFrontUrl);
      if (input.idCardBackUrl) evidenceList.push(input.idCardBackUrl);
      if (input.selfieUrl) evidenceList.push(input.selfieUrl);
      if (Array.isArray(input.identityEvidence)) {
        for (const url of input.identityEvidence) {
          if (url && !evidenceList.includes(url)) evidenceList.push(url);
        }
      }

      if (evidenceList.length > 0) {
        await tx.query(
          `INSERT INTO seller_verifications (seller_id, status, verification_type, evidence_urls, submitted_at, created_at, updated_at)
           VALUES ($1, 'pending', 'identity', $2::jsonb, $3, $3, $3)
           ON CONFLICT (seller_id) WHERE status = 'pending'
           DO UPDATE SET evidence_urls = $2::jsonb, submitted_at = $3, updated_at = $3`,
          [sellerId, JSON.stringify(evidenceList), now],
        );
      }

      // Audit review history
      try {
        await tx.query(
          `INSERT INTO seller_review_history (seller_id, previous_status, new_status, action, reviewer_id, created_at)
           VALUES ($1, $2, 'pending', $3, $4, $5)`,
          [sellerId, previousStatus, previousStatus === "none" ? "submitted" : "resubmitted", userId, now],
        );
      } catch {
        // non-fatal
      }

      // Update user role to seller
      await tx.query(
        `UPDATE users SET role = 'seller', updated_at = $1 WHERE id = $2`,
        [now, userId],
      );

      const seller: SellerProfileRecord = {
        id: sellerId,
        userId,
        businessName: input.businessName || shopName,
        businessType: input.businessType || "individual",
        taxId: input.taxId || null,
        idCardNumber: input.idNumber || input.idCardNumber || null,
        verificationStatus,
        status: sellerStatus,
        createdAt: now,
        updatedAt: now,
      };

      const shop: ShopRecord = {
        id: shopId,
        sellerId,
        name: shopName,
        slug,
        description: shopDescription,
        status: "active",
        rating: 0,
        reviewCount: 0,
        createdAt: now,
        updatedAt: now,
      };

      return { seller, shop };
    });
  }

  async updateShop(shopId: string, input: UpdateShopInput): Promise<ShopRecord> {
    const updates: string[] = ["updated_at = NOW()"];
    const params: any[] = [];
    let idx = 1;

    if (input.name !== undefined) {
      updates.push(`name = $${idx++}`);
      params.push(input.name);
    }
    if (input.description !== undefined) {
      updates.push(`description = $${idx++}`);
      params.push(input.description);
    }
    if (input.logoUrl !== undefined) {
      updates.push(`logo = $${idx++}`);
      params.push(input.logoUrl);
    }
    if (input.coverUrl !== undefined) {
      updates.push(`cover = $${idx++}`);
      params.push(input.coverUrl);
    }

    params.push(shopId);
    const query = `
      UPDATE shops SET ${updates.join(", ")}
      WHERE id = $${idx}
      RETURNING id, seller_id as "sellerId", name, slug, description,
                logo as "logoUrl", cover as "coverUrl", status, rating,
                product_count as "reviewCount", created_at as "createdAt", updated_at as "updatedAt"
    `;

    const res = await this.db.query<any>(query, params);
    if (res.rows.length === 0) throw new Error("Shop not found");
    const r = res.rows[0];
    return {
      ...r,
      rating: Number(r.rating || 0),
      reviewCount: Number(r.reviewCount || 0),
    };
  }

  async createProduct(shopId: string, input: CreateProductInput): Promise<ProductDetailRecord> {
    return this.db.transaction(async (tx: IDatabaseClient) => {
      const productId = crypto.randomUUID();
      const slug = input.slug || `${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${productId.slice(0, 8)}`;
      const priceSatang = Math.round(input.price * 100);
      const originalPriceSatang = input.originalPrice ? Math.round(input.originalPrice * 100) : null;
      const imagesJson = JSON.stringify(input.images || []);
      const primaryImage = input.primaryImageUrl || (input.images && input.images[0]) || null;
      const now = new Date().toISOString();

      // Insert product
      await tx.query(
        `INSERT INTO products (id, shop_id, category_id, name, slug, description, price, original_price,
                               currency, total_quantity, reserved_quantity, status, images, primary_image_url,
                               rating, review_count, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, 'published', $11, $12, 0.0, 0, $13, $13)`,
        [
          productId,
          shopId,
          input.categoryId,
          input.name,
          slug,
          input.description || "",
          priceSatang,
          originalPriceSatang,
          input.currency || "THB",
          input.totalQuantity,
          imagesJson,
          primaryImage,
          now,
        ],
      );

      // Insert variants
      const variants: ProductVariantRecord[] = [];
      if (input.variants && input.variants.length > 0) {
        for (const v of input.variants) {
          const varId = crypto.randomUUID();
          const varPriceSatang = Math.round(v.price * 100);
          await tx.query(
            `INSERT INTO product_variants (id, product_id, name, sku, price, stock, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [varId, productId, v.name, v.sku || null, varPriceSatang, v.stock, now],
          );
          variants.push({
            id: varId,
            productId,
            name: v.name,
            sku: v.sku || null,
            price: varPriceSatang,
            stock: v.stock,
            createdAt: now,
          });
        }
      }

      return {
        id: productId,
        shopId,
        categoryId: input.categoryId,
        name: input.name,
        slug,
        description: input.description || "",
        price: priceSatang,
        originalPrice: originalPriceSatang,
        currency: input.currency || "THB",
        totalQuantity: input.totalQuantity,
        reservedQuantity: 0,
        status: "published",
        images: input.images || [],
        primaryImageUrl: primaryImage,
        rating: 0,
        reviewCount: 0,
        createdAt: now,
        updatedAt: now,
        variants,
      };
    });
  }

  async updateProduct(productId: string, input: UpdateProductInput): Promise<ProductRecord> {
    const updates: string[] = ["updated_at = NOW()"];
    const params: any[] = [];
    let idx = 1;

    if (input.name !== undefined) {
      updates.push(`name = $${idx++}`);
      params.push(input.name);
    }
    if (input.description !== undefined) {
      updates.push(`description = $${idx++}`);
      params.push(input.description);
    }
    if (input.categoryId !== undefined) {
      updates.push(`category_id = $${idx++}`);
      params.push(input.categoryId);
    }
    if (input.price !== undefined) {
      updates.push(`price = $${idx++}`);
      params.push(Math.round(input.price * 100));
    }
    if (input.originalPrice !== undefined) {
      updates.push(`original_price = $${idx++}`);
      params.push(Math.round(input.originalPrice * 100));
    }
    if (input.totalQuantity !== undefined) {
      updates.push(`total_quantity = $${idx++}`);
      params.push(input.totalQuantity);
    }
    if (input.status !== undefined) {
      updates.push(`status = $${idx++}`);
      params.push(input.status);
    }
    if (input.images !== undefined) {
      updates.push(`images = $${idx++}`);
      params.push(JSON.stringify(input.images));
    }
    if (input.primaryImageUrl !== undefined) {
      updates.push(`primary_image_url = $${idx++}`);
      params.push(input.primaryImageUrl);
    }

    params.push(productId);
    const query = `
      UPDATE products SET ${updates.join(", ")}
      WHERE id = $${idx}
      RETURNING id, shop_id as "shopId", category_id as "categoryId", name, slug, description,
                price, original_price as "originalPrice", currency, total_quantity as "totalQuantity",
                reserved_quantity as "reservedQuantity", status, images, primary_image_url as "primaryImageUrl",
                rating, review_count as "reviewCount", created_at as "createdAt", updated_at as "updatedAt"
    `;

    const res = await this.db.query<any>(query, params);
    if (res.rows.length === 0) throw new Error("Product not found");
    return res.rows[0];
  }

  async deleteProduct(productId: string): Promise<boolean> {
    const res = await this.db.query(
      `UPDATE products SET status = 'delisted', updated_at = NOW() WHERE id = $1`,
      [productId],
    );
    return res.rowCount > 0;
  }

  async getProductById(productId: string): Promise<ProductDetailRecord | null> {
    const res = await this.db.query<any>(
      `SELECT id, shop_id as "shopId", category_id as "categoryId", name, slug, description,
              price, original_price as "originalPrice", currency, total_quantity as "totalQuantity",
              reserved_quantity as "reservedQuantity", status, images, primary_image_url as "primaryImageUrl",
              rating, review_count as "reviewCount", created_at as "createdAt", updated_at as "updatedAt"
       FROM products WHERE id = $1`,
      [productId],
    );
    if (res.rows.length === 0) return null;
    const product = res.rows[0];

    const variantsRes = await this.db.query<any>(
      `SELECT id, product_id as "productId", name, sku, price, stock, created_at as "createdAt"
       FROM product_variants WHERE product_id = $1`,
      [productId],
    );

    return {
      ...product,
      variants: variantsRes.rows,
    };
  }
}

export class MockSellerRepository implements ISellerRepository {
  private sellers: Map<string, SellerProfileRecord> = new Map();
  private shops: Map<string, ShopRecord> = new Map();
  private products: Map<string, ProductRecord> = new Map();
  private variants: Map<string, ProductVariantRecord[]> = new Map();

  async getSellerByUserId(userId: string): Promise<SellerProfileRecord | null> {
    return Array.from(this.sellers.values()).find((s) => s.userId === userId) || null;
  }

  async getShopBySellerId(sellerId: string): Promise<ShopRecord | null> {
    return Array.from(this.shops.values()).find((s) => s.sellerId === sellerId) || null;
  }

  async createSellerAndShop(
    userId: string,
    input: ApplySellerInput,
  ): Promise<{ seller: SellerProfileRecord; shop: ShopRecord }> {
    const sellerId = crypto.randomUUID();
    const shopId = crypto.randomUUID();
    const now = new Date().toISOString();

    const hasEvidence = Boolean(
      input.idCardFrontUrl ||
      input.idCardBackUrl ||
      input.selfieUrl ||
      (Array.isArray(input.identityEvidence) && input.identityEvidence.length > 0)
    );
    const verificationStatus: VerificationStatus = hasEvidence ? "pending" : "unverified";

    const seller: SellerProfileRecord = {
      id: sellerId,
      userId,
      businessName: input.businessName || input.shopName,
      businessType: input.businessType || "individual",
      taxId: input.taxId || null,
      idCardNumber: input.idNumber || input.idCardNumber || null,
      verificationStatus,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };

    const shop: ShopRecord = {
      id: shopId,
      sellerId,
      name: input.shopName,
      slug: input.shopSlug || `shop-${Date.now()}`,
      description: input.shopDescription || "",
      category: input.shopCategory || null,
      phone: input.phone || null,
      address: input.shopAddress || null,
      status: "active",
      rating: 0,
      reviewCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.sellers.set(sellerId, seller);
    this.shops.set(shopId, shop);

    return { seller, shop };
  }

  async updateShop(shopId: string, input: UpdateShopInput): Promise<ShopRecord> {
    const shop = this.shops.get(shopId);
    if (!shop) throw new Error("Shop not found");

    const updated: ShopRecord = {
      ...shop,
      name: input.name !== undefined ? input.name : shop.name,
      description: input.description !== undefined ? input.description : shop.description,
      logoUrl: input.logoUrl !== undefined ? input.logoUrl : shop.logoUrl,
      coverUrl: input.coverUrl !== undefined ? input.coverUrl : shop.coverUrl,
      updatedAt: new Date().toISOString(),
    };

    this.shops.set(shopId, updated);
    return updated;
  }

  async createProduct(shopId: string, input: CreateProductInput): Promise<ProductDetailRecord> {
    const productId = crypto.randomUUID();
    const slug = input.slug || `${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${productId.slice(0, 8)}`;
    const priceSatang = Math.round(input.price * 100);
    const originalPriceSatang = input.originalPrice ? Math.round(input.originalPrice * 100) : null;
    const now = new Date().toISOString();

    const product: ProductRecord = {
      id: productId,
      shopId,
      categoryId: input.categoryId,
      name: input.name,
      slug,
      description: input.description || "",
      price: priceSatang,
      originalPrice: originalPriceSatang,
      currency: input.currency || "THB",
      totalQuantity: input.totalQuantity,
      reservedQuantity: 0,
      status: "published",
      images: input.images || [],
      primaryImageUrl: input.primaryImageUrl || (input.images && input.images[0]) || null,
      rating: 0,
      reviewCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    const variantList: ProductVariantRecord[] = (input.variants || []).map((v) => ({
      id: crypto.randomUUID(),
      productId,
      name: v.name,
      sku: v.sku || null,
      price: Math.round(v.price * 100),
      stock: v.stock,
      createdAt: now,
    }));

    this.products.set(productId, product);
    this.variants.set(productId, variantList);

    return {
      ...product,
      variants: variantList,
    };
  }

  async updateProduct(productId: string, input: UpdateProductInput): Promise<ProductRecord> {
    const p = this.products.get(productId);
    if (!p) throw new Error("Product not found");

    const updated: ProductRecord = {
      ...p,
      name: input.name !== undefined ? input.name : p.name,
      description: input.description !== undefined ? input.description : p.description,
      categoryId: input.categoryId !== undefined ? input.categoryId : p.categoryId,
      price: input.price !== undefined ? Math.round(input.price * 100) : p.price,
      originalPrice: input.originalPrice !== undefined ? Math.round(input.originalPrice * 100) : p.originalPrice,
      totalQuantity: input.totalQuantity !== undefined ? input.totalQuantity : p.totalQuantity,
      status: input.status !== undefined ? input.status : p.status,
      images: input.images !== undefined ? input.images : p.images,
      primaryImageUrl: input.primaryImageUrl !== undefined ? input.primaryImageUrl : p.primaryImageUrl,
      updatedAt: new Date().toISOString(),
    };

    this.products.set(productId, updated);
    return updated;
  }

  async deleteProduct(productId: string): Promise<boolean> {
    const p = this.products.get(productId);
    if (!p) return false;
    p.status = "delisted";
    p.updatedAt = new Date().toISOString();
    return true;
  }

  async getProductById(productId: string): Promise<ProductDetailRecord | null> {
    const product = this.products.get(productId);
    if (!product) return null;
    const variants = this.variants.get(productId) || [];
    return {
      ...product,
      variants,
    };
  }
}
