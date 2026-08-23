import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { setupRoutes } from "./routes/index.js";
import { setupGoogleAuth } from "./routes/auth.js";
import { setupWebSocket } from "./realtime/index.js";

const app = express();
const server = createServer(app);

// ─── Middleware ──────────────────────────────────────────
app.use(helmet());
app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));

const corsOrigins = process.env.CORS_ORIGINS?.split(",").map((s) => s.trim()) || [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://localhost:5176",
];

app.use(cors({
  origin: corsOrigins,
  credentials: true,
}));

// ─── Health Check ───────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── Google OAuth ─────────────────────────────────────
setupGoogleAuth(app);

// ─── Routes ─────────────────────────────────────────────
setupRoutes(app);

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
});
