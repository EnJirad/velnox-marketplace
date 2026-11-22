import type { ICatalogRepository } from "./catalog-repository.js";
import type {
  CategoryRecord,
  CategoryTreeNode,
  ProductDetailRecord,
  ProductListFilter,
  ProductRecord,
  ShopRecord,
} from "./types.js";

export class CatalogService {
  constructor(private readonly repo: ICatalogRepository) {}

  async getCategoryTree(): Promise<CategoryTreeNode[]> {
    const rawCategories = await this.repo.getCategories();
    return this.buildTree(rawCategories);
  }

  async getCategoryBySlug(slug: string): Promise<CategoryRecord | null> {
    return this.repo.getCategoryBySlug(slug);
  }

  async listProducts(filter: ProductListFilter): Promise<{
    items: Array<any>;
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const page = filter.page && filter.page > 0 ? filter.page : 1;
    const limit = filter.limit && filter.limit > 0 ? filter.limit : 20;

    const { products, total } = await this.repo.getProducts({ ...filter, page, limit });
    const totalPages = Math.ceil(total / limit) || 1;

    // Map database satang minor units to standard API decimal format (or keep satang minor units)
    const items = products.map((p) => this.mapProductSummary(p));

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  async getProductById(id: string): Promise<any | null> {
    const product = await this.repo.getProductById(id);
    if (!product) return null;
    return this.mapProductDetail(product);
  }

  async getProductBySlug(slug: string): Promise<any | null> {
    const product = await this.repo.getProductBySlug(slug);
    if (!product) return null;
    return this.mapProductDetail(product);
  }

  async getShop(idOrSlug: string): Promise<ShopRecord | null> {
    // Try by ID first, then slug
    let shop = await this.repo.getShopById(idOrSlug);
    if (!shop) {
      shop = await this.repo.getShopBySlug(idOrSlug);
    }
    return shop;
  }

  private buildTree(categories: CategoryRecord[]): CategoryTreeNode[] {
    const nodeMap = new Map<string, CategoryTreeNode>();
    const roots: CategoryTreeNode[] = [];

    // Initialize nodes
    for (const cat of categories) {
      nodeMap.set(cat.id, {
        ...cat,
        children: [],
      });
    }

    // Connect parents and children
    for (const cat of categories) {
      const node = nodeMap.get(cat.id)!;
      if (cat.parentId && nodeMap.has(cat.parentId)) {
        nodeMap.get(cat.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  private mapProductSummary(p: ProductRecord): any {
    // In @velnox/api-contract, price is moneyDecimalSchema (THB units)
    // 2990000 satang -> 29900.00 THB
    const priceNum = typeof p.price === "bigint" ? Number(p.price) : p.price;
    const originalPriceNum =
      p.originalPrice !== null && p.originalPrice !== undefined
        ? typeof p.originalPrice === "bigint"
          ? Number(p.originalPrice)
          : p.originalPrice
        : null;

    return {
      id: p.id,
      shopId: p.shopId,
      shopName: p.shopName || "Velnox Seller",
      name: p.name,
      slug: p.slug,
      price: priceNum / 100,
      originalPrice: originalPriceNum !== null ? originalPriceNum / 100 : null,
      currency: p.currency || "THB",
      primaryImageUrl: p.primaryImageUrl || (p.images && p.images[0]) || null,
      rating: Number(p.rating) || 0,
      reviewCount: Number(p.reviewCount) || 0,
      isAvailable: p.status === "published" && p.totalQuantity > p.reservedQuantity,
    };
  }

  private mapProductDetail(p: ProductDetailRecord): any {
    const summary = this.mapProductSummary(p);
    return {
      ...summary,
      description: p.description || "",
      images: Array.isArray(p.images) ? p.images : [],
      variants: (p.variants || []).map((v) => {
        const varPrice = typeof v.price === "bigint" ? Number(v.price) : v.price;
        return {
          id: v.id,
          name: v.name,
          sku: v.sku || undefined,
          price: varPrice / 100,
          stock: v.stock,
        };
      }),
      categoryPath: p.categoryPath || [],
    };
  }
}
