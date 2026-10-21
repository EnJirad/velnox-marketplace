/**
 * MVP API — entry point and route inventory.
 *
 * ROUTING STRATEGY (Phase 3)
 * --------------------------
 * The MVP API is mounted in its OWN namespace, `/api/mvp/*`, and is enabled by
 * `MVP_API_ENABLED=true`. The pre-MVP routes keep serving the deployed
 * frontends unchanged; nothing here reads a pre-MVP table and nothing there
 * reads an MVP table. That is what lets the rewrite land incrementally without
 * switching production traffic onto a backend whose database has not been cut
 * over yet (`db/mvp/cutover.md` §3).
 *
 * Why a flag whose default is OFF: the deployed Render service points
 * `DATABASE_URL` at the pre-MVP Neon database, which has no MVP tables. Mounting
 * these routes there would not break existing traffic, but it would expose
 * endpoints that can only 500. Off by default means production behaviour is
 * byte-identical until the owner performs the cutover; the Phase 3 staging
 * deployment (new database) sets `MVP_API_ENABLED=true`.
 *
 *   POST   /api/mvp/auth/signup | login | logout | bootstrap-owner
 *   GET    /api/mvp/auth/me | oauth (501, parked)
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
import { mvpErrorHandler } from "./http.js";
import { setupMvpOrderRoutes } from "./orders.js";
import { setupMvpPaymentRoutes } from "./payments.js";
import { setupMvpSellerRoutes } from "./seller.js";

export const MVP_API_PREFIX = "/api/mvp";

/** The MVP tree is opt-in; see the routing strategy above. */
export function isMvpApiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MVP_API_ENABLED === "true";
}

export function setupMvpRoutes(app: Express): void {
  setupMvpAuthRoutes(app);
  setupMvpSellerRoutes(app);
  setupMvpCatalogRoutes(app);
  setupMvpCartRoutes(app);
  setupMvpOrderRoutes(app);
  setupMvpPaymentRoutes(app);
  setupMvpAdminRoutes(app);

  // JSON errors for this namespace, including errors raised by the auth
  // middleware (`requireActiveUser` → 403 for a suspended account, etc.).
  app.use(MVP_API_PREFIX, mvpErrorHandler);
}
