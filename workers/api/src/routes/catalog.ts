import { Hono } from "hono";
import { createSuccessEnvelope } from "@velnox/api-contract";
import { neon } from "@neondatabase/serverless";
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
 * Helper to fetch full category tree with real product counts from Neon DB
 */
async function fetchCategoryTreeWithStats(env?: Bindings): Promise<any[]> {
  if (env?.DATABASE_URL) {
    try {
      const sql = neon(env.DATABASE_URL);
      const rows = await sql`
        SELECT c.id, c.name, c.slug,
               COALESCE(c.icon, c.icon_url) as icon,
               COALESCE(c.image_url, c.icon_url) as "imageUrl",
               c.parent_id as "parentId",
               c.sort_order as "sortOrder",
               c.is_active as "isActive",
               COUNT(p.id)::int as "productCount"
        FROM categories c
        LEFT JOIN products p ON p.category_id = c.id AND (p.status = 'published' OR p.status = 'active')
        WHERE c.is_active = TRUE
        GROUP BY c.id
        ORDER BY c.sort_order ASC, c.name ASC
      `;
      const nodeMap = new Map<string, any>();
      const roots: any[] = [];
      for (const r of rows) {
        nodeMap.set(r.id, {
          id: r.id,
          name: r.name,
          slug: r.slug,
          icon: r.icon,
          imageUrl: r.imageUrl,
          parentId: r.parentId,
          sortOrder: r.sortOrder,
          isActive: r.isActive,
          productCount: r.productCount || 0,
          children: [],
        });
      }
      for (const r of rows) {
        const node = nodeMap.get(r.id);
        if (r.parentId && nodeMap.has(r.parentId)) {
          nodeMap.get(r.parentId).children.push(node);
        } else {
          roots.push(node);
        }
      }
      return roots;
    } catch (err) {
      console.error("[catalog] category tree with stats error:", err);
    }
  }
  return [];
}

/**
 * GET /api/v1/categories or /api/v1/catalog/categories
 */
catalogRoutes.get("/categories", async (c) => {
  const env = c.env as Bindings | undefined;
  const dbTree = await fetchCategoryTreeWithStats(env);
  if (dbTree.length > 0) {
    return c.json({ success: true, data: dbTree });
  }
  const service = getCatalogService(c);
  const tree = await service.getCategoryTree();
  return c.json({
    success: true,
    data: tree,
  });
});

/**
 * GET /api/v1/categories/tree or /api/categories/tree
 */
catalogRoutes.get("/categories/tree", async (c) => {
  const env = c.env as Bindings | undefined;
  const dbTree = await fetchCategoryTreeWithStats(env);
  if (dbTree.length > 0) {
    return c.json({ success: true, data: dbTree });
  }
  const service = getCatalogService(c);
  const tree = await service.getCategoryTree();
  return c.json({ success: true, data: tree });
});

catalogRoutes.get("/tree", async (c) => {
  const env = c.env as Bindings | undefined;
  const dbTree = await fetchCategoryTreeWithStats(env);
  if (dbTree.length > 0) {
    return c.json({ success: true, data: dbTree });
  }
  const service = getCatalogService(c);
  const tree = await service.getCategoryTree();
  return c.json({ success: true, data: tree });
});

/**
 * GET /api/v1/categories/stats or /api/categories/stats
 */
catalogRoutes.get("/categories/stats", async (c) => {
  const env = c.env as Bindings | undefined;
  const dbTree = await fetchCategoryTreeWithStats(env);
  if (dbTree.length > 0) {
    return c.json({ success: true, data: dbTree });
  }
  const service = getCatalogService(c);
  const tree = await service.getCategoryTree();
  return c.json({ success: true, data: tree });
});

catalogRoutes.get("/stats", async (c) => {
  const env = c.env as Bindings | undefined;
  const dbTree = await fetchCategoryTreeWithStats(env);
  if (dbTree.length > 0) {
    return c.json({ success: true, data: dbTree });
  }
  const service = getCatalogService(c);
  const tree = await service.getCategoryTree();
  return c.json({ success: true, data: tree });
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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseProductFilter(query: Record<string, string>) {
  return {
    q: query.q,
    categoryId: query.categoryId,
    categorySlug: query.categorySlug || query.category,
    minPrice: query.minPrice ? Number(query.minPrice) : undefined,
    maxPrice: query.maxPrice ? Number(query.maxPrice) : undefined,
    sort: (query.sort || query.sortBy) as any,
    page: query.page
      ? Number(query.page)
      : query.offset
        ? Math.floor(Number(query.offset) / (Number(query.limit) || 20)) + 1
        : 1,
    limit: query.limit ? Number(query.limit) : 20,
    shopId: query.shopId,
    status: query.status,
  };
}

/**
 * GET /api/v1/products or /api/v1/catalog/products
 */
catalogRoutes.get("/products", async (c) => {
  const query = c.req.query();
  const service = getCatalogService(c);
  const filter = parseProductFilter(query);
  const result = await service.listProducts(filter);

  return c.json({
    success: true,
    data: result.items,
    pagination: result.pagination,
  });
});

/**
 * GET /api/v1/products/catalog (Frontend compatibility alias)
 */
catalogRoutes.get("/products/catalog", async (c) => {
  const query = c.req.query();
  const service = getCatalogService(c);
  const filter = parseProductFilter(query);
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

/**
 * GET /api/v1/shops
 */
catalogRoutes.get("/shops", async (c) => {
  const service = getCatalogService(c);
  const env = c.env as Bindings | undefined;
  if (env?.DATABASE_URL) {
    const db = createNeonClient(env.DATABASE_URL, env.ENVIRONMENT);
    const res = await db.query<any>(
      `SELECT sh.id, sh.name, sh.slug, sh.description, sh.logo_url as "logoUrl", sh.cover_url as "coverUrl",
              sh.rating, sh.status, s.verification_status as "verificationStatus"
       FROM shops sh
       JOIN sellers s ON s.id = sh.seller_id
       WHERE sh.status = 'active'
       ORDER BY sh.rating DESC LIMIT 50`,
    );
    return c.json({ success: true, data: res.rows });
  }

  return c.json({ success: true, data: [] });
});

/**
 * GET /api/v1/shops/:id/settings
 */
catalogRoutes.get("/shops/:id/settings", async (c) => {
  const shopId = c.req.param("id");
  return c.json({
    success: true,
    data: {
      shopId,
      theme: "default",
      allowDirectChat: true,
      shippingMethods: ["Standard Express"],
    },
  });
});



/**
 * GET /api/v1/announcements
 */
catalogRoutes.get("/announcements", async (c) => {
  const env = c.env as Bindings | undefined;
  if (env?.DATABASE_URL) {
    try {
      const sql = neon(env.DATABASE_URL);
      const rows = await sql`SELECT value FROM platform_settings WHERE key = 'shop_announcements'`;
      if (rows.length > 0 && rows[0].value) {
        const items = JSON.parse(rows[0].value);
        if (Array.isArray(items) && items.length > 0) {
          const activeItems = items.filter((item) => item && item.active !== false);
          if (activeItems.length > 0) {
            return c.json({ success: true, data: activeItems });
          }
        }
      }
    } catch (err) {
      console.error("[catalog] announcements error:", err);
    }
  }

  return c.json({
    success: true,
    data: [
      {
        id: "banner-welcome",
        title: "ยินดีต้อนรับสู่ Velnox Marketplace",
        subtitle: "แพลตฟอร์มตลาดออนไลน์มาตรฐานใหม่",
        imageUrl: "/banners/welcome.webp",
        ctaUrl: "/products",
        ctaLabel: "เลือกซื้อสินค้า",
        active: true,
        placement: "home_hero",
        type: "announcement",
      },
    ],
  });
});

/**
 * GET & POST /api/v1/products/:id/reviews
 */
catalogRoutes.get("/products/:id/reviews", async (c) => {
  return c.json({ success: true, data: { reviews: [], total: 0 } });
});

catalogRoutes.post("/products/:id/reviews", async (c) => {
  const body = (await c.req.json().catch(() => null)) as any;
  return c.json({ success: true, data: { id: crypto.randomUUID(), ...body } }, 201);
});

/**
 * GET /api/v1/shops/:id/reviews
 */
catalogRoutes.get("/shops/:id/reviews", async (c) => {
  return c.json({ success: true, data: { reviews: [], total: 0 } });
});
