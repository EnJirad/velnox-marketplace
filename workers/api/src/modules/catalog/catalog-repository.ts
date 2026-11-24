import type { IDatabaseClient } from "../../core/database/db-client.js";
import type {
  CategoryRecord,
  CategoryTreeNode,
  ProductDetailRecord,
  ProductListFilter,
  ProductRecord,
  ProductVariantRecord,
  ShopRecord,
} from "./types.js";

export interface ICatalogRepository {
  getCategories(): Promise<CategoryRecord[]>;
  getCategoryBySlug(slug: string): Promise<CategoryRecord | null>;
  getProducts(filter: ProductListFilter): Promise<{ products: ProductRecord[]; total: number }>;
  getProductById(id: string): Promise<ProductDetailRecord | null>;
  getProductBySlug(slug: string): Promise<ProductDetailRecord | null>;
  getShopById(id: string): Promise<ShopRecord | null>;
  getShopBySlug(slug: string): Promise<ShopRecord | null>;
}

export class NeonCatalogRepository implements ICatalogRepository {
  constructor(private readonly db: IDatabaseClient) {}

  async getCategories(): Promise<CategoryRecord[]> {
    const res = await this.db.query<any>(
      `SELECT id, parent_id as "parentId", name, name_th as "nameTh", name_en as "nameEn",
              name_my as "nameMy", slug, level, icon_url as "iconUrl", sort_order as "sortOrder",
              is_active as "isActive", created_at as "createdAt"
       FROM categories
       WHERE is_active = TRUE
       ORDER BY level ASC, sort_order ASC, name ASC`,
    );
    return res.rows;
  }

  async getCategoryBySlug(slug: string): Promise<CategoryRecord | null> {
    const res = await this.db.query<any>(
      `SELECT id, parent_id as "parentId", name, name_th as "nameTh", name_en as "nameEn",
              name_my as "nameMy", slug, level, icon_url as "iconUrl", sort_order as "sortOrder",
              is_active as "isActive", created_at as "createdAt"
       FROM categories
       WHERE slug = $1 AND is_active = TRUE`,
      [slug],
    );
    return res.rows[0] || null;
  }

  async getProducts(filter: ProductListFilter): Promise<{ products: ProductRecord[]; total: number }> {
    const conditions: string[] = ["p.status = 'published'", "(s.status IS NULL OR s.status = 'active')"];
    const params: any[] = [];
    let idx = 1;

    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (filter.q) {
      conditions.push(`(p.name ILIKE $${idx} OR p.description ILIKE $${idx})`);
      params.push(`%${filter.q}%`);
      idx++;
    }

    if (filter.categoryId) {
      if (UUID_REGEX.test(filter.categoryId)) {
        conditions.push(`p.category_id = $${idx}`);
        params.push(filter.categoryId);
        idx++;
      } else {
        conditions.push(`p.category_id IN (SELECT id FROM categories WHERE slug = $${idx} OR parent_id IN (SELECT id FROM categories WHERE slug = $${idx}))`);
        params.push(filter.categoryId);
        idx++;
      }
    } else if (filter.categorySlug) {
      conditions.push(`p.category_id IN (SELECT id FROM categories WHERE slug = $${idx} OR parent_id IN (SELECT id FROM categories WHERE slug = $${idx}))`);
      params.push(filter.categorySlug);
      idx++;
    }

    if (filter.shopId) {
      if (UUID_REGEX.test(filter.shopId)) {
        conditions.push(`p.shop_id = $${idx}`);
        params.push(filter.shopId);
        idx++;
      } else {
        conditions.push(`p.shop_id IN (SELECT id FROM shops WHERE slug = $${idx})`);
        params.push(filter.shopId);
        idx++;
      }
    }

    if (filter.minPrice !== undefined) {
      // Satang conversion if passed in decimal or satang
      const minSatang = Math.round(filter.minPrice * 100);
      conditions.push(`p.price >= $${idx}`);
      params.push(minSatang);
      idx++;
    }

    if (filter.maxPrice !== undefined) {
      const maxSatang = Math.round(filter.maxPrice * 100);
      conditions.push(`p.price <= $${idx}`);
      params.push(maxSatang);
      idx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Count
    const countRes = await this.db.query<any>(
      `SELECT COUNT(*)::int as count FROM products p LEFT JOIN shops s ON p.shop_id = s.id ${whereClause}`,
      params,
    );
    const total = countRes.rows[0]?.count || 0;

    // Sorting
    let orderBy = "p.created_at DESC";
    if (filter.sort === "price_asc") orderBy = "p.price ASC";
    else if (filter.sort === "price_desc") orderBy = "p.price DESC";
    else if (filter.sort === "popular") orderBy = "p.rating DESC, p.review_count DESC";

    const page = filter.page && filter.page > 0 ? filter.page : 1;
    const limit = filter.limit && filter.limit > 0 ? filter.limit : 20;
    const offset = (page - 1) * limit;

    const query = `
      SELECT p.id, p.shop_id as "shopId", s.name as "shopName", p.category_id as "categoryId",
             p.name, p.slug, p.description, p.price, p.original_price as "originalPrice",
             p.currency, p.total_quantity as "totalQuantity", p.reserved_quantity as "reservedQuantity",
             p.status, p.images, p.primary_image_url as "primaryImageUrl",
             p.rating, p.review_count as "reviewCount",
             p.created_at as "createdAt", p.updated_at as "updatedAt"
      FROM products p
      LEFT JOIN shops s ON p.shop_id = s.id
      ${whereClause}
      ORDER BY ${orderBy}
      LIMIT $${idx} OFFSET $${idx + 1}
    `;
    params.push(limit, offset);

    const res = await this.db.query<any>(query, params);
    return { products: res.rows, total };
  }

  async getProductById(id: string): Promise<ProductDetailRecord | null> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return null;
    }

    const res = await this.db.query<any>(
      `SELECT p.id, p.shop_id as "shopId", s.name as "shopName", p.category_id as "categoryId",
              p.name, p.slug, p.description, p.price, p.original_price as "originalPrice",
              p.currency, p.total_quantity as "totalQuantity", p.reserved_quantity as "reservedQuantity",
              p.status, p.images, p.primary_image_url as "primaryImageUrl",
              p.rating, p.review_count as "reviewCount",
              p.created_at as "createdAt", p.updated_at as "updatedAt"
       FROM products p
       LEFT JOIN shops s ON p.shop_id = s.id
       WHERE p.id = $1 AND (s.status IS NULL OR s.status = 'active')`,
      [id],
    );

    if (res.rows.length === 0) return null;
    const product = res.rows[0];

    const variantsRes = await this.db.query<any>(
      `SELECT id, product_id as "productId", name, sku, price, stock, created_at as "createdAt"
       FROM product_variants WHERE product_id = $1`,
      [id],
    );

    return {
      ...product,
      variants: variantsRes.rows,
    };
  }

  async getProductBySlug(slug: string): Promise<ProductDetailRecord | null> {
    const res = await this.db.query<any>(
      `SELECT p.id, p.shop_id as "shopId", s.name as "shopName", p.category_id as "categoryId",
              p.name, p.slug, p.description, p.price, p.original_price as "originalPrice",
              p.currency, p.total_quantity as "totalQuantity", p.reserved_quantity as "reservedQuantity",
              p.status, p.images, p.primary_image_url as "primaryImageUrl",
              p.rating, p.review_count as "reviewCount",
              p.created_at as "createdAt", p.updated_at as "updatedAt"
       FROM products p
       LEFT JOIN shops s ON p.shop_id = s.id
       WHERE p.slug = $1 AND (s.status IS NULL OR s.status = 'active')`,
      [slug],
    );

    if (res.rows.length === 0) return null;
    const product = res.rows[0];

    const variantsRes = await this.db.query<any>(
      `SELECT id, product_id as "productId", name, sku, price, stock, created_at as "createdAt"
       FROM product_variants WHERE product_id = $1`,
      [product.id],
    );

    return {
      ...product,
      variants: variantsRes.rows,
    };
  }

  async getShopById(id: string): Promise<ShopRecord | null> {
    const res = await this.db.query<any>(
      `SELECT id, seller_id as "sellerId", name, slug, description, logo_url as "logoUrl",
              cover_url as "coverUrl", status, rating, review_count as "reviewCount",
              created_at as "createdAt", updated_at as "updatedAt"
       FROM shops WHERE id = $1`,
      [id],
    );
    return res.rows[0] || null;
  }

  async getShopBySlug(slug: string): Promise<ShopRecord | null> {
    const res = await this.db.query<any>(
      `SELECT id, seller_id as "sellerId", name, slug, description, logo_url as "logoUrl",
              cover_url as "coverUrl", status, rating, review_count as "reviewCount",
              created_at as "createdAt", updated_at as "updatedAt"
       FROM shops WHERE slug = $1`,
      [slug],
    );
    return res.rows[0] || null;
  }
}

export class MockCatalogRepository implements ICatalogRepository {
  private categories: CategoryRecord[] = [
    {
      id: "00000000-0000-0000-0000-000000000001",
      parentId: null,
      name: "Electronics",
      nameTh: "อิเล็กทรอนิกส์และไอที",
      nameEn: "Electronics & IT",
      nameMy: "အီလက်ထရွန်းနစ်",
      slug: "electronics",
      level: 1,
      sortOrder: 1,
      isActive: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: "00000000-0000-0000-0000-000000000002",
      parentId: "00000000-0000-0000-0000-000000000001",
      name: "Smartphones & Tablets",
      nameTh: "สมาร์ทโฟนและแท็บเล็ต",
      nameEn: "Smartphones & Tablets",
      nameMy: "စမတ်ဖုန်းနှင့် တက်ဘလက်",
      slug: "smartphones-tablets",
      level: 2,
      sortOrder: 1,
      isActive: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: "00000000-0000-0000-0000-000000000003",
      parentId: "00000000-0000-0000-0000-000000000001",
      name: "Computers & Laptops",
      nameTh: "คอมพิวเตอร์และแล็ปท็อป",
      nameEn: "Computers & Laptops",
      nameMy: "ကွန်ပျူတာနှင့် လက်ပ်တော့",
      slug: "computers-laptops",
      level: 2,
      sortOrder: 2,
      isActive: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: "00000000-0000-0000-0000-000000000004",
      parentId: null,
      name: "Fashion",
      nameTh: "แฟชั่น",
      nameEn: "Fashion",
      nameMy: "ဖက်ရှင်",
      slug: "fashion",
      level: 1,
      sortOrder: 2,
      isActive: true,
      createdAt: new Date().toISOString(),
    },
  ];

  private shops: Map<string, ShopRecord> = new Map([
    [
      "shop-001",
      {
        id: "shop-001",
        sellerId: "seller-001",
        name: "Velnox Official Flagship",
        slug: "velnox-official",
        description: "Official store for premium quality products on Velnox.",
        logoUrl: "https://pub-75f6f26e59df431b854fe53caedb49b6.r2.dev/logos/velnox.png",
        coverUrl: "https://pub-75f6f26e59df431b854fe53caedb49b6.r2.dev/covers/velnox.png",
        status: "active",
        rating: 4.9,
        reviewCount: 1250,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  ]);

  private products: Map<string, ProductRecord> = new Map([
    [
      "prod-001",
      {
        id: "prod-001",
        shopId: "shop-001",
        shopName: "Velnox Official Flagship",
        categoryId: "00000000-0000-0000-0000-000000000002",
        name: "Velnox Pro Max Smartphone 256GB",
        slug: "velnox-pro-max-smartphone-256gb",
        description: "Next-generation smartphone with 120Hz OLED and pro camera system.",
        price: 2990000, // 29,900.00 THB in satang
        originalPrice: 3290000,
        currency: "THB",
        totalQuantity: 100,
        reservedQuantity: 5,
        status: "published",
        images: ["https://pub-75f6f26e59df431b854fe53caedb49b6.r2.dev/products/phone1.webp"],
        primaryImageUrl: "https://pub-75f6f26e59df431b854fe53caedb49b6.r2.dev/products/phone1.webp",
        rating: 4.8,
        reviewCount: 154,
        createdAt: "2026-11-20T10:00:00.000Z",
        updatedAt: "2026-11-20T10:00:00.000Z",
      },
    ],
    [
      "prod-002",
      {
        id: "prod-002",
        shopId: "shop-001",
        shopName: "Velnox Official Flagship",
        categoryId: "00000000-0000-0000-0000-000000000003",
        name: "UltraBook Air 14-inch M3",
        slug: "ultrabook-air-14-inch-m3",
        description: "Ultra-thin laptop with all-day battery life and high performance.",
        price: 3990000, // 39,900.00 THB in satang
        originalPrice: 4290000,
        currency: "THB",
        totalQuantity: 50,
        reservedQuantity: 2,
        status: "published",
        images: ["https://pub-75f6f26e59df431b854fe53caedb49b6.r2.dev/products/laptop1.webp"],
        primaryImageUrl: "https://pub-75f6f26e59df431b854fe53caedb49b6.r2.dev/products/laptop1.webp",
        rating: 4.9,
        reviewCount: 88,
        createdAt: "2026-11-21T10:00:00.000Z",
        updatedAt: "2026-11-21T10:00:00.000Z",
      },
    ],
  ]);

  private variants: Map<string, ProductVariantRecord[]> = new Map([
    [
      "prod-001",
      [
        {
          id: "var-001",
          productId: "prod-001",
          name: "Titanium Black 256GB",
          sku: "VPRO-BLK-256",
          price: 2990000,
          stock: 50,
          createdAt: new Date().toISOString(),
        },
        {
          id: "var-002",
          productId: "prod-001",
          name: "Natural Titanium 256GB",
          sku: "VPRO-NAT-256",
          price: 2990000,
          stock: 50,
          createdAt: new Date().toISOString(),
        },
      ],
    ],
  ]);

  async getCategories(): Promise<CategoryRecord[]> {
    return [...this.categories];
  }

  async getCategoryBySlug(slug: string): Promise<CategoryRecord | null> {
    return this.categories.find((c) => c.slug === slug) || null;
  }

  async getProducts(filter: ProductListFilter): Promise<{ products: ProductRecord[]; total: number }> {
    let filtered = Array.from(this.products.values()).filter((p) => {
      const shop = this.shops.get(p.shopId);
      return p.status === "published" && (!shop || shop.status === "active");
    });

    if (filter.q) {
      const q = filter.q.toLowerCase();
      filtered = filtered.filter(
        (p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q),
      );
    }

    if (filter.categoryId || filter.categorySlug) {
      const catTarget = filter.categoryId || filter.categorySlug;
      filtered = filtered.filter((p) => {
        if (p.categoryId === catTarget) return true;
        const matchingCat = this.categories.find(c => c.slug === catTarget || c.id === catTarget);
        return Boolean(matchingCat && p.categoryId === matchingCat.id);
      });
    }

    if (filter.shopId) {
      filtered = filtered.filter((p) => p.shopId === filter.shopId);
    }

    if (filter.minPrice !== undefined) {
      const minSatang = Math.round(filter.minPrice * 100);
      filtered = filtered.filter((p) => Number(p.price) >= minSatang);
    }

    if (filter.maxPrice !== undefined) {
      const maxSatang = Math.round(filter.maxPrice * 100);
      filtered = filtered.filter((p) => Number(p.price) <= maxSatang);
    }

    // Sort
    if (filter.sort === "price_asc") {
      filtered.sort((a, b) => Number(a.price) - Number(b.price));
    } else if (filter.sort === "price_desc") {
      filtered.sort((a, b) => Number(b.price) - Number(a.price));
    } else if (filter.sort === "popular") {
      filtered.sort((a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount);
    } else {
      filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    const total = filtered.length;
    const page = filter.page && filter.page > 0 ? filter.page : 1;
    const limit = filter.limit && filter.limit > 0 ? filter.limit : 20;
    const offset = (page - 1) * limit;

    return {
      products: filtered.slice(offset, offset + limit),
      total,
    };
  }

  async getProductById(id: string): Promise<ProductDetailRecord | null> {
    const product = this.products.get(id);
    if (!product) return null;
    const shop = this.shops.get(product.shopId);
    if (shop && shop.status !== "active") return null;
    const variants = this.variants.get(id) || [];
    return {
      ...product,
      variants,
    };
  }

  async getProductBySlug(slug: string): Promise<ProductDetailRecord | null> {
    const product = Array.from(this.products.values()).find((p) => p.slug === slug);
    if (!product) return null;
    const shop = this.shops.get(product.shopId);
    if (shop && shop.status !== "active") return null;
    const variants = this.variants.get(product.id) || [];
    return {
      ...product,
      variants,
    };
  }

  async getShopById(id: string): Promise<ShopRecord | null> {
    return this.shops.get(id) || null;
  }

  async getShopBySlug(slug: string): Promise<ShopRecord | null> {
    return Array.from(this.shops.values()).find((s) => s.slug === slug) || null;
  }

  // Helpers for testing / mutations
  addProduct(product: ProductRecord, variants: ProductVariantRecord[] = []): void {
    this.products.set(product.id, product);
    this.variants.set(product.id, variants);
  }

  addShop(shop: ShopRecord): void {
    this.shops.set(shop.id, shop);
  }
}
