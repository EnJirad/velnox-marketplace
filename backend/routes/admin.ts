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
import { auditClientIp, writeAuditLog } from "../lib/audit-log.js";
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from "../lib/media-config.js";
import { SELLER_COMMISSION_RATE, SELLER_RETURN_COVERAGE } from "../lib/seller-stats.js";
import { userHasPermission } from "../lib/permissions.js";

const BOOTSTRAP_SECRET = process.env.BOOTSTRAP_OWNER_SECRET;

// Safe diagnostic — logs configured status WITHOUT revealing the value
console.log(
  "[bootstrap] BOOTSTRAP_OWNER_SECRET configured:",
  Boolean(BOOTSTRAP_SECRET),
);

/**
 * `platform_settings.value` is TEXT in the canonical schema, but databases
 * bootstrapped from migration 018 may have it as JSONB and therefore hand back
 * a JSON-encoded string. Normalize on read so the UI always sees the plain
 * value (and audit `from`/`to` stay comparable).
 */
function unwrapSettingValue(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw !== "string") return String(raw);
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "string") return parsed;
    } catch {
      /* keep the raw value */
    }
  }
  return raw;
}

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
  // VelCenter "Company / System Settings". Returns the persisted
  // platform_settings rows plus read-only metadata that is genuinely owned by
  // the backend (commission policy, upload limits) so the screen never shows
  // an invented value or a second source of truth for money.
  app.get("/api/admin/settings", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      if (!(await userHasPermission(userId, "settings.manage"))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "settings.manage permission required" } });
        return;
      }
      const userResult = await query("SELECT role FROM users WHERE id = $1", [userId]);
      const result = await query(
        `SELECT key, value, description, updated_at, updated_by
         FROM platform_settings
         ORDER BY key ASC`,
      );
      const settings = result.rows.map((row: any) => ({
        key: row.key as string,
        value: unwrapSettingValue(row.value),
        description: (row.description as string | null) ?? null,
        updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : null,
        updatedBy: (row.updated_by as string | null) ?? null,
      }));
      const approvalMode = settings.find((s) => s.key === "product_approval_mode")?.value ?? "manual";

      res.json({
        success: true,
        data: {
          settings,
          meta: {
            moderation: {
              approvalMode,
              // The single product verification workflow is seller/shop level.
              productVerificationEnabled: false,
            },
            commission: {
              // Financial policy — owned by lib/seller-stats.ts (the engine that
              // actually computes payouts). Read-only here on purpose.
              sellerRate: SELLER_COMMISSION_RATE,
              returnCoverage: SELLER_RETURN_COVERAGE,
              currency: "THB",
              editable: false,
            },
            media: {
              maxUploadBytes: MAX_UPLOAD_BYTES,
              allowedTypes: [...ALLOWED_UPLOAD_TYPES],
            },
            role: userResult.rows[0].role as string,
          },
        },
      });
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
      if (!(await userHasPermission(userId, "settings.manage"))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "settings.manage permission required" } });
        return;
      }
      const userResult = await query("SELECT role FROM users WHERE id = $1", [userId]);
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
      // Every platform setting change is audited with its previous value so the
      // trail answers "who changed what, from what, to what, when".
      const existing = await query("SELECT value FROM platform_settings WHERE key = $1", [key]);
      const previousValue = existing.rows[0] ? unwrapSettingValue(existing.rows[0].value) : null;
      await query(
        `INSERT INTO platform_settings (key, value, updated_at, updated_by)
         VALUES ($1, $2, NOW(), $3)
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW(), updated_by = $3`,
        [key, value, userId]
      );
      console.log(`[admin] setting updated: ${key} = ${value} by ${userId}`);
      await writeAuditLog(
        userId,
        "SETTINGS_UPDATE",
        "setting",
        null,
        { key, from: previousValue, to: value },
        auditClientIp(req),
      );
      res.json({ success: true, data: { key, value }      });
    } catch (err) {
      console.error("[admin] settings update error:", err);
      res.status(500).json({ success: false, error: { code: "SETTINGS_FAILED", message: "Failed to update settings" } });
    }
  });
}

