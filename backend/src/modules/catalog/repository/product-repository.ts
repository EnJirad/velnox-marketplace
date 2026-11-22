import type { DbQueryable } from "../../../../database/src/types.ts";
import type { Product, ProductDetail, ProductFilters, ProductVariant } from "../domain/product.ts";

export class ProductRepository {
  public static async list(
    db: DbQueryable,
    filters: ProductFilters = {},
  ): Promise<{ products: readonly Product[]; total: number }> {
    const conditions: string[] = ["p.status = 'published'"];
    const params: any[] = [];
    let idx = 1;

    if (filters.categorySlug) {
      conditions.push(`p.category_id = $${idx++}`);
      params.push(filters.categorySlug);
    }

    if (filters.shopId) {
      conditions.push(`p.shop_id = $${idx++}`);
      params.push(filters.shopId);
    }

    if (filters.search) {
      conditions.push(`(p.title ILIKE $${idx} OR p.description ILIKE $${idx})`);
      params.push(`%${filters.search}%`);
      idx++;
    }

    const whereClause = conditions.join(" AND ");
    const limit = Math.min(Math.max(Number(filters.limit ?? 20), 1), 100);
    const page = Math.max(Number(filters.page ?? 1), 1);
    const offset = (page - 1) * limit;

    const countRes = await db.query(
      `SELECT COUNT(*)::int AS total FROM products p WHERE ${whereClause};`,
      params,
    );
    const total = Number(countRes.rows[0]?.total ?? 0);

    const listSql = `
      SELECT p.id, p.shop_id, p.category_id, p.title, p.description, p.price,
             p.status, p.images, p.rating, p.sales_count, p.created_at, p.updated_at
      FROM products p
      WHERE ${whereClause}
      ORDER BY p.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++};
    `;
    const listRes = await db.query(listSql, [...params, limit, offset]);

    return {
      products: listRes.rows.map(this.mapProduct),
      total,
    };
  }

  public static async findById(db: DbQueryable, id: string): Promise<ProductDetail | null> {
    const productSql = `
      SELECT p.id, p.shop_id, p.category_id, p.title, p.description, p.price,
             p.status, p.images, p.rating, p.sales_count, p.created_at, p.updated_at,
             s.name AS shop_name, s.status AS shop_status,
             c.id AS cat_id, c.slug AS cat_slug, c.names AS cat_names,
             COALESCE(i.quantity - i.reserved, 0) AS available_stock
      FROM products p
      LEFT JOIN shops s ON s.id = p.shop_id
      LEFT JOIN categories c ON c.slug = p.category_id
      LEFT JOIN inventory i ON i.product_id = p.id
      WHERE p.id = $1 AND p.status = 'published'
      LIMIT 1;
    `;
    const res = await db.query(productSql, [id]);
    if (!res.rows || res.rows.length === 0) return null;

    const row = res.rows[0];

    // Fetch variants if any
    const variantsRes = await db.query(
      `SELECT id, product_id, title, sku, price, stock, image_url
       FROM product_variants WHERE product_id = $1 ORDER BY id ASC;`,
      [id],
    );

    const variants: ProductVariant[] = (variantsRes.rows || []).map((v: any) => ({
      id: String(v.id),
      productId: String(v.product_id),
      title: String(v.title),
      sku: v.sku ? String(v.sku) : null,
      priceMinor: BigInt(Math.round(Number(v.price ?? 0) * 100)),
      stock: Number(v.stock ?? 0),
      imageUrl: v.image_url ? String(v.image_url) : null,
    }));

    const catNames = typeof row.cat_names === "string" ? JSON.parse(row.cat_names) : (row.cat_names ?? {});
    const catName = catNames.th || catNames.en || row.cat_slug || "Category";

    return {
      ...this.mapProduct(row),
      shop: {
        id: String(row.shop_id),
        name: String(row.shop_name ?? "Shop"),
        isVerified: row.shop_status === "approved",
      },
      category: {
        id: String(row.cat_id ?? ""),
        slug: String(row.cat_slug ?? row.category_id),
        name: catName,
      },
      stock: Number(row.available_stock ?? 0),
      variants,
    };
  }

  private static mapProduct(row: any): Product {
    const rawPrice = Number(row.price ?? 0);
    const priceMinor = BigInt(Math.round(rawPrice * 100));
    let images: string[] = [];
    if (Array.isArray(row.images)) images = row.images;
    else if (typeof row.images === "string") {
      try { images = JSON.parse(row.images); } catch { images = [row.images]; }
    }

    return {
      id: String(row.id),
      shopId: String(row.shop_id),
      categoryId: String(row.category_id),
      title: String(row.title),
      description: String(row.description ?? ""),
      priceMinor,
      status: row.status,
      images,
      rating: Number(row.rating ?? 5.0),
      salesCount: Number(row.sales_count ?? 0),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}
