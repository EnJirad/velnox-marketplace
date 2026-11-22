import type { IDatabaseClient } from "../../core/database/db-client.js";
import type {
  ApplySellerInput,
  CreateProductInput,
  SellerProfileRecord,
  ShopRecord,
  UpdateProductInput,
  UpdateShopInput,
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
      `SELECT id, user_id as "userId", business_name as "businessName", business_type as "businessType",
              tax_id as "taxId", id_card_number as "idCardNumber", verification_status as "verificationStatus",
              verification_rejected_reason as "verificationRejectedReason", verified_at as "verifiedAt",
              created_at as "createdAt", updated_at as "updatedAt"
       FROM sellers WHERE user_id = $1`,
      [userId],
    );
    return res.rows[0] || null;
  }

  async getShopBySellerId(sellerId: string): Promise<ShopRecord | null> {
    const res = await this.db.query<any>(
      `SELECT id, seller_id as "sellerId", name, slug, description, logo_url as "logoUrl",
              cover_url as "coverUrl", status, rating, review_count as "reviewCount",
              created_at as "createdAt", updated_at as "updatedAt"
       FROM shops WHERE seller_id = $1`,
      [sellerId],
    );
    return res.rows[0] || null;
  }

  async createSellerAndShop(
    userId: string,
    input: ApplySellerInput,
  ): Promise<{ seller: SellerProfileRecord; shop: ShopRecord }> {
    return this.db.transaction(async (tx: IDatabaseClient) => {
      const sellerId = crypto.randomUUID();
      const shopId = crypto.randomUUID();
      const now = new Date().toISOString();

      // 1. Insert seller
      await tx.query(
        `INSERT INTO sellers (id, user_id, business_name, business_type, tax_id, id_card_number, verification_status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'unverified', $7, $7)`,
        [sellerId, userId, input.businessName, input.businessType, input.taxId || null, input.idCardNumber || null, now],
      );

      // 2. Insert shop
      await tx.query(
        `INSERT INTO shops (id, seller_id, name, slug, description, status, rating, review_count, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'active', 0.0, 0, $6, $6)`,
        [shopId, sellerId, input.shopName, input.shopSlug, input.shopDescription || "", now],
      );

      // 3. Update user role to seller
      await tx.query(
        `UPDATE users SET role = 'seller', updated_at = $1 WHERE id = $2`,
        [now, userId],
      );

      const seller: SellerProfileRecord = {
        id: sellerId,
        userId,
        businessName: input.businessName,
        businessType: input.businessType,
        taxId: input.taxId || null,
        idCardNumber: input.idCardNumber || null,
        verificationStatus: "unverified",
        createdAt: now,
        updatedAt: now,
      };

      const shop: ShopRecord = {
        id: shopId,
        sellerId,
        name: input.shopName,
        slug: input.shopSlug,
        description: input.shopDescription || "",
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
      updates.push(`logo_url = $${idx++}`);
      params.push(input.logoUrl);
    }
    if (input.coverUrl !== undefined) {
      updates.push(`cover_url = $${idx++}`);
      params.push(input.coverUrl);
    }

    params.push(shopId);
    const query = `
      UPDATE shops SET ${updates.join(", ")}
      WHERE id = $${idx}
      RETURNING id, seller_id as "sellerId", name, slug, description, logo_url as "logoUrl",
                cover_url as "coverUrl", status, rating, review_count as "reviewCount",
                created_at as "createdAt", updated_at as "updatedAt"
    `;

    const res = await this.db.query<any>(query, params);
    if (res.rows.length === 0) throw new Error("Shop not found");
    return res.rows[0];
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

    const seller: SellerProfileRecord = {
      id: sellerId,
      userId,
      businessName: input.businessName,
      businessType: input.businessType,
      taxId: input.taxId || null,
      idCardNumber: input.idCardNumber || null,
      verificationStatus: "unverified",
      createdAt: now,
      updatedAt: now,
    };

    const shop: ShopRecord = {
      id: shopId,
      sellerId,
      name: input.shopName,
      slug: input.shopSlug,
      description: input.shopDescription || "",
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
