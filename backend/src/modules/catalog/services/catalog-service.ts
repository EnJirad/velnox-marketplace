import type { DbQueryable } from "../../../../database/src/types.ts";
import { CategoryRepository } from "../repository/category-repository.ts";
import { ProductRepository } from "../repository/product-repository.ts";
import type { Category, CategoryTreeNode } from "../domain/category.ts";
import type { Product, ProductDetail, ProductFilters } from "../domain/product.ts";
import { NotFoundError } from "../../../core/errors/app-error.ts";

export class CatalogService {
  public static async getCategories(db: DbQueryable): Promise<readonly Category[]> {
    return CategoryRepository.findAllActive(db);
  }

  public static async getCategoryTree(db: DbQueryable): Promise<readonly CategoryTreeNode[]> {
    return CategoryRepository.findTree(db);
  }

  public static async getProducts(
    db: DbQueryable,
    filters: ProductFilters = {},
  ): Promise<{ products: readonly Product[]; total: number; page: number; limit: number; hasMore: boolean }> {
    const page = Math.max(Number(filters.page ?? 1), 1);
    const limit = Math.min(Math.max(Number(filters.limit ?? 20), 1), 100);

    const { products, total } = await ProductRepository.list(db, { ...filters, page, limit });
    const hasMore = page * limit < total;

    return { products, total, page, limit, hasMore };
  }

  public static async getProductDetail(db: DbQueryable, id: string): Promise<ProductDetail> {
    const product = await ProductRepository.findById(db, id);
    if (!product) {
      throw new NotFoundError(`Product '${id}' not found or inactive`);
    }
    return product;
  }
}
