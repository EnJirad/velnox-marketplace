/**
 * MVP API — entry point and route inventory.
 *
 * ROUTING STRATEGY
 * ----------------
 * This is the ONLY API. It lives in its own namespace, `/api/mvp/*`, mounted
 * unconditionally from `server.ts` against the one database the repository
 * ships a schema for (`db/schema.sql`). There is no second route tree and no
 * flag selecting between them: a switch whose default hid the API would 404
 * every frontend call, and a switch guarding a deleted tree would be a lie. The
 * database a deployment points at is a deployment concern, not a route concern.
 *
 * Nothing here reads a table outside `db/schema.sql` — that boundary is asserted
 * by `tests/isolation.test.ts` rather than by a flag.
 *
 *   POST   /api/mvp/auth/signup | login | logout | bootstrap-owner
 *   GET    /api/mvp/auth/me | providers | oauth → google/start
 *   GET    /api/mvp/auth/google/start | google/callback
 *
 *   GET/PATCH /api/mvp/profile · POST /api/mvp/profile/avatar/presign | confirm
 *   DELETE /api/mvp/profile/avatar
 *
 *   POST   /api/mvp/seller/apply
 *   GET    /api/mvp/seller/status
 *   POST   /api/mvp/seller/products
 *   GET    /api/mvp/seller/products[/:id]
 *   PATCH  /api/mvp/seller/products/:id
 *   POST   /api/mvp/seller/products/:id/submit | publish | variants
 *   PATCH  /api/mvp/seller/products/:id/variants/:variantId
 *   PUT    /api/mvp/seller/products/:id/inventory
 *   GET    /api/mvp/seller/orders
 *   PATCH  /api/mvp/seller/orders/:id/status
 *
 *   GET    /api/mvp/categories
 *   GET    /api/mvp/products[/:slug]
 *   GET    /api/mvp/products/:slug/reviews · POST products/:slug/reviews
 *   GET    /api/mvp/products/:slug/reviews/me
 *   PATCH/DELETE /api/mvp/reviews/:id
 *
 *   GET    /api/mvp/favorites | favorites/ids
 *   POST/DELETE /api/mvp/favorites/:productId
 *
 *   GET    /api/mvp/cart
 *   POST   /api/mvp/cart/items
 *   PATCH  /api/mvp/cart/items/:id
 *   DELETE /api/mvp/cart/items/:id
 *   POST   /api/mvp/checkout
 *
 *   GET    /api/mvp/orders[/:id]
 *   POST   /api/mvp/orders/:id/cancel
 *   GET    /api/mvp/orders/:id/payment-status
 *   POST   /api/mvp/orders/:id/payment-session
 *   POST   /api/mvp/payments/webhook
 *   GET    /api/mvp/payments/status
 *
 *   GET    /api/mvp/admin/sellers | products | categories | metrics
 *   POST   /api/mvp/admin/sellers/:id/approve | reject | suspend
 *   POST   /api/mvp/admin/products/:id/approve | reject
 *   POST   /api/mvp/admin/categories  ·  PATCH/DELETE /api/mvp/admin/categories/:id
 *   POST   /api/mvp/admin/maintenance/expire-pending-orders
 */
import type { Express } from "express";
import { setupMvpAdminRoutes } from "./admin.js";
import { setupMvpAuthRoutes } from "./auth.js";
import { setupMvpCartRoutes } from "./cart.js";
import { setupMvpCatalogRoutes } from "./catalog.js";
import { setupMvpFavoriteRoutes } from "./favorites.js";
import { mvpErrorHandler } from "./http.js";
import { setupMvpOrderRoutes } from "./orders.js";
import { setupMvpPaymentRoutes } from "./payments.js";
import { setupMvpProfileRoutes } from "./profile.js";
import { setupMvpReviewRoutes } from "./reviews.js";
import { setupMvpSellerRoutes } from "./seller.js";

export const MVP_API_PREFIX = "/api/mvp";

export function setupMvpRoutes(app: Express): void {
  setupMvpAuthRoutes(app);
  setupMvpSellerRoutes(app);
  setupMvpCatalogRoutes(app);
  setupMvpReviewRoutes(app);
  setupMvpFavoriteRoutes(app);
  setupMvpProfileRoutes(app);
  setupMvpCartRoutes(app);
  setupMvpOrderRoutes(app);
  setupMvpPaymentRoutes(app);
  setupMvpAdminRoutes(app);

  // JSON errors for this namespace, including errors raised by the auth
  // middleware (`requireActiveUser` → 403 for a suspended account, etc.).
  app.use(MVP_API_PREFIX, mvpErrorHandler);
}
