/**
 * Storefront announcements (VelShop home carousel).
 *
 * Storage: `platform_settings` key `shop_announcements` holding a JSON array.
 * No new table and no schema migration deliberately — the platform settings
 * store already exists for owner-managed configuration, and the shape is small
 * (a handful of slides with an optional image URL, copy and destination).
 *
 *   GET  /api/announcements          public — active items only, sorted
 *   PUT  /api/admin/announcements    settings.manage — replace the list
 *
 * Images are uploaded through the existing R2 presign flow with
 * `purpose: "announcement"`, so the carousel only ever holds real URLs minted by
 * this backend.
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { query } from "../db/index.js";
import { userHasPermission } from "../lib/permissions.js";

const SETTINGS_KEY = "shop_announcements";
const MAX_ITEMS = 10;
const MAX_TEXT = 240;

export interface AnnouncementItem {
  id: string;
  title: string;
  description: string;
  imageUrl: string | null;
  linkUrl: string | null;
  active: boolean;
  sortOrder: number;
}

/** Values may be stored JSON-encoded or raw (older rows) — accept both. */
function parseStoredValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function asText(value: unknown, max = MAX_TEXT): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function asUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  // Only http(s) images and in-app paths — never javascript: or data: payloads.
  if (raw.startsWith("/")) return raw.slice(0, 500);
  if (/^https?:\/\//i.test(raw)) return raw.slice(0, 1000);
  return null;
}

function normaliseItem(input: unknown, index: number): AnnouncementItem | null {
  if (!input || typeof input !== "object") return null;
  const row = input as Record<string, unknown>;
  const title = asText(row.title, 120);
  if (!title) return null;
  const id = asText(row.id, 64) || `a${index + 1}`;
  return {
    id,
    title,
    description: asText(row.description),
    imageUrl: asUrl(row.imageUrl),
    linkUrl: asUrl(row.linkUrl),
    active: row.active !== false,
    sortOrder: Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : index,
  };
}

export function normaliseAnnouncements(input: unknown): AnnouncementItem[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item, index) => normaliseItem(item, index))
    .filter((item): item is AnnouncementItem => item !== null)
    .slice(0, MAX_ITEMS)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

async function readAnnouncements(): Promise<AnnouncementItem[]> {
  const result = await query("SELECT value FROM platform_settings WHERE key = $1", [SETTINGS_KEY]);
  if (result.rows.length === 0) return [];
  return normaliseAnnouncements(parseStoredValue(result.rows[0].value));
}

export function setupAnnouncementRoutes(app: Express): void {
  // ── Public: what VelShop renders ------------------------------------------
  app.get("/api/announcements", async (_req: Request, res: Response) => {
    try {
      const items = (await readAnnouncements()).filter((item) => item.active);
      res.json({ success: true, data: items });
    } catch (error) {
      console.error("[announcements] read failed:", error);
      // The storefront must survive a settings-table problem: empty list, 200.
      res.json({ success: true, data: [] });
    }
  });

  // ── Admin: replace the list (VelCenter settings) --------------------------
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
        error: { code: "ANNOUNCEMENT_READ_FAILED", message: "Could not read announcements" },
      });
    }
  });

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

      const items = normaliseAnnouncements((req.body as { items?: unknown })?.items);
      const payload = JSON.stringify(items);
      if (payload.length > 20_000) {
        res.status(400).json({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Too much content for announcements" },
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
        [SETTINGS_KEY, payload, "VelShop home announcements (JSON array)", userId],
      );

      res.json({ success: true, data: items });
    } catch (error) {
      console.error("[announcements] save failed:", error);
      res.status(500).json({
        success: false,
        error: { code: "ANNOUNCEMENT_SAVE_FAILED", message: "Could not save announcements" },
      });
    }
  });
}
