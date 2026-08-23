import express from "express";
import cors from "cors";
import helmet from "helmet";
import { pool, testConnection } from "./db/index.js";
import { authRouter } from "./api/auth.js";
import { productsRouter } from "./api/products.js";
import { categoriesRouter } from "./api/categories.js";
import { cartRouter } from "./api/cart.js";
import { shopsRouter } from "./api/shops.js";
import { ordersRouter } from "./api/orders.js";
import { addressesRouter } from "./api/addresses.js";

const app = express();
const PORT = process.env.PORT || 3001;

// Security
app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGINS?.split(",") || ["http://localhost:5173"],
    credentials: true,
  })
);

// Body parsing
app.use(express.json({ limit: "10mb" }));

// Request logging
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// Health check
app.get("/health", async (_req, res) => {
  const dbOk = await testConnection();
  res.json({
    status: dbOk ? "ok" : "degraded",
    database: dbOk ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
  });
});

// API routes
app.use("/api/auth", authRouter);
app.use("/api/products", productsRouter);
app.use("/api/categories", categoriesRouter);
app.use("/api/cart", cartRouter);
app.use("/api/shops", shopsRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/addresses", addressesRouter);

// 404
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: { code: "NOT_FOUND", message: "Endpoint not found" },
  });
});

// Error handler
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error("Unhandled error:", err);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Something went wrong" },
    });
  }
);

async function start() {
  const dbOk = await testConnection();
  if (!dbOk) {
    console.error("Failed to connect to database. Check DATABASE_URL.");
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`Velnox API running on port ${PORT}`);
  });
}

start();
