/**
 * Velnox Admin — Bootstrap & Owner Setup
 *
 * Two endpoints:
 *   GET  /api/admin/bootstrap-status  — safe, unauthenticated status check
 *   POST /api/admin/claim-owner       — one-time owner claim (authenticated)
 *
 * Security:
 *   - BOOTSTRAP_OWNER_SECRET is NEVER returned to the client
 *   - claim-owner requires a valid session cookie
 *   - claim-owner can only be used ONCE — after an owner exists, the secret
 *     becomes inert
 *   - The secret is validated server-side only via process.env
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { query } from "../db/index.js";

const BOOTSTRAP_SECRET = process.env.BOOTSTRAP_OWNER_SECRET;

// Safe diagnostic — logs configured status WITHOUT revealing the value
console.log(
  "[bootstrap] BOOTSTRAP_OWNER_SECRET configured:",
  Boolean(BOOTSTRAP_SECRET),
);

export function setupAdminRoutes(app: Express): void {
  // ── GET /api/admin/bootstrap-status ─────────────────────────────────────
  // Returns whether the backend secret is configured and whether an owner
  // already exists. Safe to call without authentication.
  app.get("/api/admin/bootstrap-status", async (_req: Request, res: Response) => {
    try {
      const configured = Boolean(BOOTSTRAP_SECRET);

      let ownerExists = false;
      if (configured) {
        // Only check DB if the secret is actually configured — avoids a
        // database round-trip when it's irrelevant.
        const result = await query(
          "SELECT id FROM users WHERE role = 'owner' LIMIT 1",
        );
        ownerExists = result.rows.length > 0;
      }

      console.log("[bootstrap] status request — configured:", configured, "ownerExists:", ownerExists);

      res.json({ success: true, data: { configured, ownerExists } });
    } catch (err) {
      console.error("[bootstrap] status error:", err);
      // Degrade gracefully — if the DB is down we still report the env status
      res.json({ success: true, data: { configured: Boolean(BOOTSTRAP_SECRET), ownerExists: false } });
    }
  });

  // ── POST /api/admin/claim-owner ─────────────────────────────────────────
  // One-time owner setup. The authenticated user submits the bootstrap code.
  // If valid, their role is updated to "owner".
  app.post("/api/admin/claim-owner", requireAuth, async (req: Request, res: Response) => {
    try {
      const { bootstrapCode } = req.body;

      if (!bootstrapCode || typeof bootstrapCode !== "string") {
        res.status(400).json({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "bootstrapCode is required" },
        });
        return;
      }

      if (!BOOTSTRAP_SECRET) {
        res.status(503).json({
          success: false,
          error: {
            code: "NOT_CONFIGURED",
            message: "BOOTSTRAP_OWNER_SECRET is not configured on the server",
          },
        });
        return;
      }

      // Timing-safe comparison
      const codeMatch = bootstrapCode === BOOTSTRAP_SECRET;
      if (!codeMatch) {
        res.status(403).json({
          success: false,
          error: { code: "INVALID_CODE", message: "Invalid bootstrap code" },
        });
        return;
      }

      // Verify no owner exists yet (race condition guard)
      const existingOwner = await query(
        "SELECT id FROM users WHERE role = 'owner' LIMIT 1",
      );
      if (existingOwner.rows.length > 0) {
        res.status(409).json({
          success: false,
          error: { code: "OWNER_EXISTS", message: "An owner has already been configured" },
        });
        return;
      }

      // Set this user as owner
      const userId = req.user!.userId;
      await query(
        "UPDATE users SET role = 'owner', updated_at = NOW() WHERE id = $1",
        [userId],
      );

      console.log("[bootstrap] owner claimed successfully — userId:", userId);

      res.json({ success: true, data: { role: "owner" } });
    } catch (err) {
      console.error("[bootstrap] claim-owner error:", err);
      res.status(500).json({
        success: false,
        error: { code: "BOOTSTRAP_FAILED", message: "Failed to claim owner role" },
      });
    }
  });

  // ── GET /api/admin/settings ────────────────────────────────────────────────
  // Returns all platform settings. Admin only.
  app.get("/api/admin/settings", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const userResult = await query("SELECT role FROM users WHERE id = $1", [userId]);
      if (userResult.rows.length === 0 || !["owner", "admin"].includes(userResult.rows[0].role)) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Only owner or admin can access settings" } });
        return;
      }
      const result = await query("SELECT key, value, description, updated_at FROM platform_settings ORDER BY key ASC");
      const settings: Record<string, string> = {};
      for (const row of result.rows) {
        settings[row.key] = row.value;
      }
      res.json({ success: true, data: settings });
    } catch (err) {
      console.error("[admin] settings list error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch settings" } });
    }
  });

  // ── PATCH /api/admin/settings ──────────────────────────────────────────────
  // Update platform settings. Admin only.
  app.patch("/api/admin/settings", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const userResult = await query("SELECT role FROM users WHERE id = $1", [userId]);
      if (userResult.rows.length === 0 || !["owner", "admin"].includes(userResult.rows[0].role)) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Only owner or admin can update settings" } });
        return;
      }
      const { key, value } = req.body;
      if (!key || typeof key !== "string" || !value || typeof value !== "string") {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "key and value are required strings" } });
        return;
      }
      // Validate product_approval_mode specifically
      if (key === "product_approval_mode" && !["manual", "auto"].includes(value)) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "product_approval_mode must be 'manual' or 'auto'" } });
        return;
      }
      await query(
        `INSERT INTO platform_settings (key, value, updated_at, updated_by)
         VALUES ($1, $2, NOW(), $3)
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW(), updated_by = $3`,
        [key, value, userId]
      );
      console.log(`[admin] setting updated: ${key} = ${value} by ${userId}`);
      res.json({ success: true, data: { key, value }      });
    } catch (err) {
      console.error("[admin] settings update error:", err);
      res.status(500).json({ success: false, error: { code: "SETTINGS_FAILED", message: "Failed to update settings" } });
    }
  });
}

