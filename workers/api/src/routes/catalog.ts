import { Hono } from "hono";
import { createSuccessEnvelope } from "@velnox/api-contract";
import { createNeonClient } from "../core/database/db-client.js";
import {
  type ICatalogRepository,
  MockCatalogRepository,
  NeonCatalogRepository,
} from "../modules/catalog/catalog-repository.js";
import { CatalogService } from "../modules/catalog/catalog-service.js";
import type { Bindings, Variables } from "../types.js";

export const catalogRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

let catalogServiceInstance: CatalogService | null = null;

function getCatalogService(c: any): CatalogService {
  if (catalogServiceInstance) return catalogServiceInstance;

  const env = c.env as Bindings | undefined;
  let repo: ICatalogRepository;

  if (env?.DATABASE_URL) {
    const dbClient = createNeonClient(env.DATABASE_URL, env.ENVIRONMENT);
    repo = new NeonCatalogRepository(dbClient);
  } else {
    repo = new MockCatalogRepository();
  }

  catalogServiceInstance = new CatalogService(repo);
  return catalogServiceInstance;
}

export function setTestCatalogService(service: CatalogService | null) {
  catalogServiceInstance = service;
}

/**
 * GET /api/v1/categories or /api/v1/catalog/categories
 */
catalogRoutes.get("/categories", async (c) => {
  const service = getCatalogService(c);
  const tree = await service.getCategoryTree();
  return c.json({
    success: true,
    data: tree,
  });
});

/**
 * GET /api/v1/categories/:slug
 */
catalogRoutes.get("/categories/:slug", async (c) => {
  const slug = c.req.param("slug");
  const service = getCatalogService(c);
  const category = await service.getCategoryBySlug(slug);

  if (!category) {
    return c.json(
      {
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "Category not found",
        },
      },
      404,
    );
  }

  return c.json({
    success: true,
    data: category,
  });
});

/**
 * GET /api/v1/products or /api/v1/catalog/products
 */
catalogRoutes.get("/products", async (c) => {
  const query = c.req.query();
  const service = getCatalogService(c);

  const filter = {
    q: query.q,
    categoryId: query.categoryId,
    categorySlug: query.categorySlug,
    minPrice: query.minPrice ? Number(query.minPrice) : undefined,
    maxPrice: query.maxPrice ? Number(query.maxPrice) : undefined,
    sort: query.sort as any,
    page: query.page ? Number(query.page) : 1,
    limit: query.limit ? Number(query.limit) : 20,
    shopId: query.shopId,
  };

  const result = await service.listProducts(filter);

  return c.json({
    success: true,
    data: result.items,
    pagination: result.pagination,
  });
});

/**
 * GET /api/v1/products/:id or /api/v1/catalog/products/:id
 */
catalogRoutes.get("/products/:id", async (c) => {
  const idOrSlug = c.req.param("id");
  const service = getCatalogService(c);

  // Try by id first, then slug
  let product = await service.getProductById(idOrSlug);
  if (!product) {
    product = await service.getProductBySlug(idOrSlug);
  }

  if (!product) {
    return c.json(
      {
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "Product not found",
        },
      },
      404,
    );
  }

  return c.json({
    success: true,
    data: product,
  });
});

/**
 * GET /api/v1/shops/:id or /api/v1/catalog/shops/:id
 */
catalogRoutes.get("/shops/:id", async (c) => {
  const idOrSlug = c.req.param("id");
  const service = getCatalogService(c);
  const shop = await service.getShop(idOrSlug);

  if (!shop) {
    return c.json(
      {
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "Shop not found",
        },
      },
      404,
    );
  }

  return c.json({
    success: true,
    data: shop,
  });
});
