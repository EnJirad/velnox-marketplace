/**
 * Velnox Marketplace — API service.
 *
 * ONE backend tree (`backend/mvp/`) serves ONE API (`/api/mvp/*`) against ONE
 * database (Neon, `db/schema.sql`). There is no legacy surface, no feature flag
 * hiding a second model, and no WebSocket: the client reads from the API.
 *
 * Order of middleware matters and is covered by tests:
 *
 *   1. the two webhook body buffers MUST run before `express.json()` — Stripe
 *      verifies its signature over the exact bytes it sent, so the raw body has
 *      to be captured first;
 *   2. `express.json({ limit: "1mb" })` — every remaining body is small (cart,
 *      address, checkout metadata); file bytes go straight to storage and never
 *      transit this process;
 *   3. CORS + the Origin guard — the session is an httpOnly cookie, so a
 *      cross-site state-changing request must be refused unless it comes from a
 *      trusted Velnox origin;
 *   4. rate limiting, then the routes.
 *
 * At boot the service prints the database it actually opened (name and server
 * version only — never a host, user or password) and verifies that the 20 MVP
 * tables are present. A database that is missing them is a configuration error,
 * and saying so once at boot is cheaper than discovering it at checkout.
 */
import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { createServer } from "http";

import { describeDatabaseIdentity } from "./db/index.js";
import { rateLimitSecurity } from "./middleware/rate-limit.js";
import { createOriginGuard } from "./middleware/origin-guard.js";
import { startMvpOrderExpiryScheduler } from "./jobs/mvp-order-expiry-scheduler.js";
import { setupMvpRoutes } from "./mvp/index.js";
import { mvpWebhookRawBody } from "./mvp/webhook-body.js";

const app = express();
const server = createServer(app);

app.use(helmet());
// Render sits behind a single proxy hop — required for a correct req.ip, which
// the IP-keyed rate limits read.
app.set("trust proxy", 1);
app.use(cookieParser());

app.use(mvpWebhookRawBody);
app.use(express.json({ limit: "1mb" }));

const knownOrigins = [
  process.env.VITE_VELSHOP_URL,
  process.env.VITE_VELSELLER_URL,
  process.env.VITE_VELCENTER_URL,
  process.env.VITE_CORPORATE_URL,
].filter((value): value is string => typeof value === "string" && value.length > 0);

const declaredOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const devOrigins = ["http://localhost:5173", "http://localhost:5174", "http://localhost:5175", "http://localhost:5176"];

// Merged and deduplicated so a misconfigured CORS_ORIGINS can never silently
// block a valid Velnox origin.
const allOrigins = [...new Set([...declaredOrigins, ...knownOrigins, ...devOrigins])];

app.use(cors({ origin: allOrigins, credentials: true }));
app.use(createOriginGuard(allOrigins));
app.use(rateLimitSecurity);

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

setupMvpRoutes(app);

// JSON for anything unrecognised under /api — an unknown path is a client bug,
// not a server error, and it must never fall through to an HTML error page.
app.use("/api", (_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: { code: "NOT_FOUND", message: "Unknown API endpoint" },
  });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const code = (err as { code?: string })?.code ?? null;
  console.error("[api] unhandled error", {
    code,
    message: err instanceof Error ? err.message : String(err),
  });
  res.status(500).json({
    success: false,
    error: { code: "INTERNAL_ERROR", message: "Something went wrong" },
  });
});

const PORT = parseInt(process.env.PORT || "3001", 10);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Velnox API running on port ${PORT}`);

  void describeDatabaseIdentity()
    .then((identity) => {
      const where = `database=${identity.database} server=${identity.serverVersion}`;
      if (identity.missing.length === 0) {
        console.log(`[db] ✅ MVP schema complete (${where})`);
      } else {
        console.error(`[db] ❌ MVP SCHEMA INCOMPLETE (${where}) — missing: ${identity.missing.join(", ")}`);
        console.error("   Run db/schema.sql (or db/run-sqleditor.sql in the Neon SQL Editor) against THIS database.");
      }
    })
    .catch((err: unknown) => {
      console.error("[db] identity check failed (non-fatal at boot):", {
        code: (err as { code?: string })?.code ?? null,
        message: err instanceof Error ? err.message : String(err),
      });
    });

  startMvpOrderExpiryScheduler();
});

export { app, server };
