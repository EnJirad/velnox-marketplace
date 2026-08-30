import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { setupRoutes } from "./routes/index.js";
import { setupAdminRoutes } from "./routes/admin.js";
import { setupCartRoutes } from "./routes/cart.js";
import { setupGoogleAuth } from "./routes/auth.js";
import { setupUploadRoutes } from "./routes/upload.js";
import { setupSellerRoutes } from "./routes/seller.js";
import { setupProductRoutes } from "./routes/products.js";
import { setupStripeRoutes } from "./routes/stripe.js";
import { setupVelRepeatRoutes } from "./routes/velrepeat.js";
import { setupProductOptionRoutes } from "./routes/product-options.js";
import { setupWebSocket } from "./realtime/index.js";

const app = express();
const server = createServer(app);

// ─── Middleware ──────────────────────────────────────────
app.use(helmet());
app.use(cookieParser());

// Stripe webhook needs the raw body for signature verification.
// Use a custom middleware: if path matches webhook, skip express.json
// and use express.raw instead. This must run BEFORE express.json.
app.use((req, res, next) => {
  if (req.path === "/api/payments/stripe/webhook" && req.method === "POST") {
    express.raw({ type: "application/json" })(req, res, next);
  } else {
    next();
  }
});

app.use(express.json({ limit: "10mb" }));

const corsOrigins = process.env.CORS_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) || [];

// Always include known production origins so CORS never silently blocks
// a valid frontend domain when CORS_ORIGINS is misconfigured.
const knownOrigins: string[] = [
  process.env.VITE_VELSHOP_URL,
  process.env.VITE_VELSELLER_URL,
  process.env.VITE_VELCENTER_URL,
  process.env.VITE_CORPORATE_URL,
].filter((u): u is string => typeof u === "string" && u.length > 0);

const devOrigins: string[] = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://localhost:5176",
];

// Merge: explicit CORS_ORIGINS + known production origins + dev origins, deduplicated
const allOrigins = [...new Set([...corsOrigins, ...knownOrigins, ...devOrigins])];

app.use(cors({
  origin: allOrigins,
  credentials: true,
}));

// ─── Auto-create variant tables if missing (V0028) ─────────────────────
async function ensureVariantTables(): Promise<void> {
  const { query } = await import("./db/index.js");
  try {
    const checks = ["product_variants", "product_option_groups", "product_option_values", "product_variant_values", "product_variant_images"];
    const missing: string[] = [];
    for (const t of checks) {
      const r = await query(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) AS exists`, [t]);
      if (!r.rows[0]?.exists) missing.push(t);
    }
    if (missing.length === 0) {
      console.log("[startup] variant/option tables exist — no migration needed");
      return;
    }
    console.log(`[startup] missing variant tables: ${missing.join(", ")} — creating...`);
    // Run V0028 SQL (all CREATE TABLE IF NOT EXISTS — idempotent)
    const fs = await import("fs");
    const path = await import("path");
    const sqlPath = path.join(process.cwd(), "db", "migrations", "028_create_variant_tables_if_missing.sql");
    const sql = fs.readFileSync(sqlPath, "utf-8");
    await query(sql);
    // Also ensure product_variant_images exists (not in V0028)
    try {
      await query(`
        CREATE TABLE IF NOT EXISTS product_variant_images (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
          product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          url TEXT NOT NULL,
          alt TEXT DEFAULT '',
          storage_key TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_variant_images_variant ON product_variant_images (variant_id);
        CREATE INDEX IF NOT EXISTS idx_variant_images_product ON product_variant_images (product_id);
      `);
      console.log("[startup] product_variant_images table ensured");
    } catch (imgErr: any) {
      if (imgErr?.code !== "42P01") console.warn("[startup] product_variant_images creation warning:", imgErr?.message);
    }
    console.log("[startup] variant/option tables created successfully");
  } catch (err: any) {
    console.error("[startup] ensureVariantTables failed:", err?.message ?? err);
  }
  // ── ALWAYS run column/table additions (separate from table creation) ──
  // These run regardless of whether tables already exist, ensuring
  // columns from V0029/V0030/V0031 are always present even if the
  // GitHub Action migration runner missed them.
  // V0029: Add discount columns to product_variants if missing
  try {
    await query(`ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS compare_at_price NUMERIC(12,2)`);
    await query(`ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5,2)`);
    console.log("[startup] V0029 discount columns ensured");
  } catch (v29Err: any) {
    console.warn("[startup] V0029 discount columns warning:", v29Err?.message);
  }
  // V0030: Add image_type and variant_id to product_images if missing
  try {
    await query(`ALTER TABLE product_images ADD COLUMN IF NOT EXISTS image_type TEXT NOT NULL DEFAULT 'gallery'`);
    await query(`ALTER TABLE product_images ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL`);
    await query(`CREATE INDEX IF NOT EXISTS idx_product_images_type ON product_images (product_id, image_type)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_product_images_variant ON product_images (variant_id) WHERE variant_id IS NOT NULL`);
    console.log("[startup] V0030 product image types ensured");
  } catch (v30Err: any) {
    console.warn("[startup] V0030 image type columns warning:", v30Err?.message);
  }
  // V0031: Add variant pricing columns + product_variant_images table + inventory.reorder_level
  try {
    await query(`ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS compare_at_price NUMERIC(12,2)`);
    await query(`ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5,2)`);
    await query(`
      CREATE TABLE IF NOT EXISTS product_variant_images (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
        product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        url TEXT NOT NULL,
        alt TEXT DEFAULT '',
        storage_key TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_variant_images_variant ON product_variant_images (variant_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_variant_images_product ON product_variant_images (product_id)`);
    await query(`ALTER TABLE inventory ADD COLUMN IF NOT EXISTS reorder_level INTEGER NOT NULL DEFAULT 0`);
    console.log("[startup] V0031 variant pricing + images ensured");
  } catch (v31Err: any) {
    console.warn("[startup] V0031 variant pricing warning:", v31Err?.message);
  }
}
ensureVariantTables();

// ─── Health Check ───────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── Schema Diagnostic (temporary — check production tables) ─────────────
app.get("/api/_diag/schema", async (_req, res) => {
  try {
    const { query } = await import("./db/index.js");
    const tables = [
      "product_variants", "product_option_groups", "product_option_values",
      "product_variant_values", "product_attributes", "customer_wishlist",
      "product_reviews", "cart_items",
    ];
    const results: Record<string, any> = {};
    for (const t of tables) {
      try {
        const r = await query(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) AS exists`, [t]);
        results[t] = r.rows[0]?.exists ?? false;
      } catch { results[t] = false; }
    }
    // Check cart_items.variant_id
    try {
      const r = await query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'cart_items' AND column_name = 'variant_id'`);
      results["cart_items.variant_id"] = r.rows.length > 0;
    } catch { results["cart_items.variant_id"] = false; }
    // Check migration state
    let migrations: string[] = [];
    try {
      const r = await query(`SELECT migration_name FROM schema_migrations ORDER BY id`);
      migrations = r.rows.map((r: any) => r.migration_name);
    } catch { migrations = ["schema_migrations table missing"];
    }
    res.json({ tables: results, migrations });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Google OAuth ─────────────────────────────────────
setupGoogleAuth(app);

// ─── Upload (R2 presigned URLs) ────────────────────────
setupUploadRoutes(app);

// ─── Routes ─────────────────────────────────────────────
setupRoutes(app);

// ─── Seller (onboarding & approval) ────────────────────
setupSellerRoutes(app);

// ─── Products (CRUD, images, catalog) ────────────────────
setupProductRoutes(app);

// ─── Cart, Wishlist, Orders ──────────────────────────────
setupCartRoutes(app);

// ─── Stripe Payments ──────────────────────────────────────
setupStripeRoutes(app);

// ─── Product Options & Attributes ──────────────────────────────
setupProductOptionRoutes(app);

// ─── VelRepeat Packages ──────────────────────────────────────
setupVelRepeatRoutes(app);

// ─── Admin (bootstrap / owner setup) ────────────────────
setupAdminRoutes(app);

// ─── WebSocket ──────────────────────────────────────────
const wss = new WebSocketServer({ server, path: "/ws" });
setupWebSocket(wss);

// ─── Start ──────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "3001", 10);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Velnox API running on port ${PORT}`);
  console.log(`📡 WebSocket available at ws://0.0.0.0:${PORT}/ws`);

  // Startup health check — log missing env vars
  const required = ["DATABASE_URL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI", "JWT_SECRET"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`⚠️  MISSING ENV VARS: ${missing.join(", ")}`);
    console.error("   Google OAuth will not work until these are set in Render Environment.");
  } else {
    console.log("✅ All required env vars are configured.");
  }
  // BOOTSTRAP_OWNER_SECRET is optional but must be set for owner initialization.
  // Logged as boolean only — the actual value is never exposed.
  console.log(`[bootstrap] BOOTSTRAP_OWNER_SECRET configured: ${Boolean(process.env.BOOTSTRAP_OWNER_SECRET)}`);
});
