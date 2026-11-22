import { Hono } from "hono";
import { cors } from "hono/cors";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { catalogRoutes } from "./routes/catalog.js";
import { sellerRoutes } from "./routes/seller.js";
import { mediaRoutes } from "./routes/media.js";
import { cartRoutes } from "./routes/cart.js";
import { orderRoutes } from "./routes/orders.js";
import type { Bindings, Variables } from "./types.js";

export function createApplication() {
  const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

  // Request ID and timing tracking
  app.use("*", async (c, next) => {
    c.set("requestId", crypto.randomUUID());
    c.set("startTime", Date.now());
    await next();
    const duration = Date.now() - c.get("startTime");
    c.header("X-Request-Id", c.get("requestId"));
    c.header("X-Response-Time", `${duration}ms`);
  });

  // CORS configuration
  app.use("*", async (c, next) => {
    const allowed = cors({
      origin: (origin) => {
        if (!origin) return "*";
        // Allow localhost development on any port
        if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return origin;
        if (/^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) return origin;
        // Allow all *.velnox.live and velnox.live domains
        if (/^https:\/\/([a-zA-Z0-9-]+\.)*velnox\.live$/.test(origin)) return origin;
        // Check custom CORS_ORIGINS from environment
        const customOrigins = c.env?.CORS_ORIGINS?.split(",").map((o) => o.trim()) || [];
        if (customOrigins.includes(origin)) return origin;
        return null;
      },
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Idempotency-Key"],
      exposeHeaders: ["X-Request-Id", "X-Response-Time"],
      credentials: true,
      maxAge: 86400,
    });
    return allowed(c, next);
  });

  // Register Global Error & 404 Handlers
  app.onError(errorHandler);
  app.notFound(notFoundHandler);

  // Mount Health Routes
  app.route("/", healthRoutes);

  // Mount Auth Routes under /api/v1/auth
  app.route("/api/v1/auth", authRoutes);

  // Mount Catalog Routes under /api/v1/catalog and /api/v1 (for category/product aliases)
  app.route("/api/v1/catalog", catalogRoutes);
  app.route("/api/v1", catalogRoutes);

  // Mount Seller Routes under /api/v1/seller
  app.route("/api/v1/seller", sellerRoutes);

  // Mount Media Routes under /api/v1/media
  app.route("/api/v1/media", mediaRoutes);

  // Mount Cart Routes under /api/v1/cart
  app.route("/api/v1/cart", cartRoutes);

  // Mount Order Routes under /api/v1/orders
  app.route("/api/v1/orders", orderRoutes);

  // Default root index endpoint
  app.get("/", (c) => {
    return c.json({
      name: c.env?.APP_NAME || "Velnox Marketplace API",
      version: c.env?.APP_VERSION || "3.0.0",
      runtime: "cloudflare-workers",
      docs: "https://api.velnox.live/api/v1/docs",
      health: "https://api.velnox.live/health",
    });
  });

  return app;
}

export const app = createApplication();
