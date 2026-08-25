import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { setupRoutes } from "./routes/index.js";
import { setupAdminRoutes } from "./routes/admin.js";
import { setupGoogleAuth } from "./routes/auth.js";
import { setupUploadRoutes } from "./routes/upload.js";
import { setupSellerRoutes } from "./routes/seller.js";
import { setupProductRoutes } from "./routes/products.js";
import { setupWebSocket } from "./realtime/index.js";

const app = express();
const server = createServer(app);

// ─── Middleware ──────────────────────────────────────────
app.use(helmet());
app.use(cookieParser());
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

// ─── Health Check ───────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
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
