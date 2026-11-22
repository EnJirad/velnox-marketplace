import type { DbQueryable } from "../../../../database/src/types.ts";
import { CatalogService } from "../services/catalog-service.ts";
import { AppError } from "../../../core/errors/app-error.ts";
import type { HttpResponse } from "../../identity/routes/auth-routes.ts";

export class CatalogController {
  public static async getCategories(db: DbQueryable): Promise<HttpResponse> {
    try {
      const data = await CatalogService.getCategories(db);
      return { status: 200, body: { success: true, data } };
    } catch (err: any) {
      return this.handleError(err);
    }
  }

  public static async getCategoryTree(db: DbQueryable): Promise<HttpResponse> {
    try {
      const data = await CatalogService.getCategoryTree(db);
      return { status: 200, body: { success: true, data } };
    } catch (err: any) {
      return this.handleError(err);
    }
  }

  public static async listProducts(
    db: DbQueryable,
    query: Record<string, string | undefined> = {},
  ): Promise<HttpResponse> {
    try {
      const result = await CatalogService.getProducts(db, {
        categorySlug: query.category,
        search: query.q,
        shopId: query.shopId,
        page: query.page ? Number(query.page) : 1,
        limit: query.limit ? Number(query.limit) : 20,
      });

      return {
        status: 200,
        body: {
          success: true,
          data: result.products.map((p) => ({
            ...p,
            priceMinor: p.priceMinor.toString(), // JSON decimal safety
          })),
          meta: {
            page: result.page,
            limit: result.limit,
            total: result.total,
            hasMore: result.hasMore,
          },
        },
      };
    } catch (err: any) {
      return this.handleError(err);
    }
  }

  public static async getProductDetail(db: DbQueryable, id: string): Promise<HttpResponse> {
    try {
      const product = await CatalogService.getProductDetail(db, id);
      return {
        status: 200,
        body: {
          success: true,
          data: {
            ...product,
            priceMinor: product.priceMinor.toString(),
            variants: product.variants.map((v) => ({
              ...v,
              priceMinor: v.priceMinor.toString(),
            })),
          },
        },
      };
    } catch (err: any) {
      return this.handleError(err);
    }
  }

  private static handleError(err: any): HttpResponse {
    if (err instanceof AppError) {
      return {
        status: err.statusCode,
        body: { success: false, error: { code: err.code, message: err.message } },
      };
    }
    return {
      status: 500,
      body: { success: false, error: { code: "INTERNAL_ERROR", message: "Catalog error" } },
    };
  }
}
