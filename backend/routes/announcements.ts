/**
 * Storefront banners (VelShop home hero carousel + promo strip).
 *
 * Storage: `platform_settings` key `shop_announcements` holding a JSON array.
 * No new table and no schema migration deliberately — the platform settings
 * store already exists for owner-managed configuration, the shape is small
 * (a handful of slides), and the key is kept so previously published content
 * survives this upgrade (v1 rows are mapped on read — see lib/banners.ts).
 *
 *   GET  /api/announcements          public — active + in-schedule, sorted
 *   GET  /api/admin/announcements    settings.manage — full list (incl. inactive)
 *   PUT  /api/admin/announcements    settings.manage — replace the list
 *
 * Images are uploaded through the existing R2 presign flow with
 * `purpose: "announcement"`, so the carousel only ever holds real URLs minted by
 * this backend.
 *
 * Banner rules live in `lib/banners.ts` (pure, unit-tested); this module does
 * only IO. An invalid item fails the save with 400 + item index — v1 silently
 * dropped invalid items, which made "empty banner rejected" indistinguishable
 * from "empty banner disappeared".
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { query } from "../db/index.js";
import { userHasPermission } from "../lib/permissions.js";
import { isBannerVisible, normaliseBanners, type Banner } from "../lib/banners.js";

const SETTINGS_KEY = "shop_announcements";

/** Values may be stored JSON-encoded or raw (older rows) — accept both. */
function parseStoredValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function readAnnouncements(): Promise<Banner[]> {
  const result = await query("SELECT value FROM platform_settings WHERE key = $1", [SETTINGS_KEY]);
  if (result.rows.length === 0) return [];
  return normaliseBanners(parseStoredValue(result.rows[0].value)).items;
}

export function setupAnnouncementRoutes(app: Express): void {
  // ── Public: what VelShop renders ------------------------------------------
  app.get("/api/announcements", async (_req: Request, res: Response) => {
    try {
      const now = new Date();
      const items = (await readAnnouncements()).filter((item) => isBannerVisible(item, now));
      res.json({ success: true, data: items });
    } catch (error) {
      console.error("[announcements] read failed:", error);
      // The storefront must survive a settings-table problem: empty list, 200.
      res.json({ success: true, data: [] });
    }
  });

  // ── Admin: full list (VelCenter marketing) ---------------------------------
  app.get("/api/admin/announcements", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      if (!(await userHasPermission(userId, "settings.manage"))) {
        res.status(403).json({
          success: false,
          error: { code: "FORBIDDEN", message: "settings.manage permission required" },
        });
        return;
      }
      res.json({ success: true, data: await readAnnouncements() });
    } catch (error) {
      console.error("[announcements] admin read failed:", error);
      res.status(500).json({
        success: false,
        error: { code: "ANNOUNCEMENT_READ_FAILED", message: "Could not read banners" },
      });
    }
  });

  // ── Admin: replace the list -------------------------------------------------
  app.put("/api/admin/announcements", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      if (!(await userHasPermission(userId, "settings.manage"))) {
        res.status(403).json({
          success: false,
          error: { code: "FORBIDDEN", message: "settings.manage permission required" },
        });
        return;
      }

      const { items, rejections } = normaliseBanners((req.body as { items?: unknown })?.items);
      const firstRejection = rejections[0];
      if (firstRejection) {
        res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: `banner ${firstRejection.index}: ${firstRejection.reason}`,
          },
        });
        return;
      }

      const payload = JSON.stringify(items);
      if (payload.length > 20_000) {
        res.status(400).json({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Too much content for banners" },
        });
        return;
      }

      await query(
        `INSERT INTO platform_settings (key, value, description, updated_at, updated_by)
         VALUES ($1, $2, $3, NOW(), $4)
         ON CONFLICT (key) DO UPDATE
           SET value = EXCLUDED.value,
               description = EXCLUDED.description,
               updated_at = NOW(),
               updated_by = EXCLUDED.updated_by`,
        [SETTINGS_KEY, payload, "VelShop home banners (JSON array)", userId],
      );

      res.json({ success: true, data: items });
    } catch (error) {
      console.error("[announcements] save failed:", error);
      res.status(500).json({
        success: false,
        error: { code: "ANNOUNCEMENT_SAVE_FAILED", message: "Could not save banners" },
      });
    }
  });
}
