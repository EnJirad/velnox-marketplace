/**
 * VelRepeat V2 — Recurring Commerce Engine (scheduler worker)
 *
 * The DATABASE is the source of truth. A polling loop (startVelRepeatScheduler)
 * finds ACTIVE plans whose next_run_at is due and processes them. Safety:
 *
 *  1. Per-plan transaction re-claims the row with `FOR UPDATE` while
 *     re-checking `status = 'active' AND next_run_at <= NOW()` — concurrent
 *     workers serialize on the row lock; the second worker sees the updated
 *     next_run_at (now in the future) and skips.
 *  2. Idempotency layer: velrepeat_runs has UNIQUE (plan_id, scheduled_for);
 *     the run insert uses ON CONFLICT DO NOTHING — a run for a given
 *     scheduled time can be created exactly once.
 *  3. Work survives restarts: due/overdue plans are simply picked up again.
 *
 * Payment: plans are created with payment_method = 'cod' (the platform's
 * default provider). Each successful run creates an order + a 'cod' payment
 * row. A real recurring payment provider (Stripe saved payment method /
 * payment intents) can be added later behind plan.payment_method without
 * changing the run/order machinery.
 */
import { query, withTransaction } from "../db/index.js";
import { reserveInventoryStock } from "../lib/inventory.js";
import type pg from "pg";

export type FrequencyType = "days" | "weeks" | "months";

export const VALID_FREQUENCIES: FrequencyType[] = ["days", "weeks", "months"];
export const RUN_STATUSES = [
  "processing", "success", "payment_failed", "out_of_stock",
  "item_unavailable", "price_changed", "failed", "cancelled",
] as const;

/**
 * Compute the next run time from a reference date (UTC). Months are added
 * with day clamping (Jan 31 + 1 month → Feb 28/29) to avoid silent skips.
 */
export function calculateNextRunAt(
  from: Date,
  frequencyType: FrequencyType,
  intervalValue: number,
): Date {
  const interval = Math.max(1, Math.floor(intervalValue) || 1);
  const d = new Date(from.getTime());
  switch (frequencyType) {
    case "days":
      d.setUTCDate(d.getUTCDate() + interval);
      break;
    case "weeks":
      d.setUTCDate(d.getUTCDate() + interval * 7);
      break;
    case "months": {
      // Compute the target year/month explicitly, then clamp the day to the
      // target month's length (Jan 31 + 1 month → Feb 28/29, never Mar 2/3).
      const day = d.getUTCDate();
      const m = d.getUTCMonth() + interval;
      const targetMonth = ((m % 12) + 12) % 12;
      const targetYear = d.getUTCFullYear() + Math.floor(m / 12);
      const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
      d.setUTCFullYear(targetYear, targetMonth, Math.min(day, lastDay));
      break;
    }
  }
  return d;
}

/** Validate a plan item row against live product/variant/inventory state. */
export function validatePlanItem(item: any): { ok: boolean; code: string; reason: string } {
  if (!item) return { ok: false, code: "item_unavailable", reason: "item missing" };
  if (!item.product_id) return { ok: false, code: "item_unavailable", reason: "product deleted" };
  if (item.product_status !== "published") {
    return { ok: false, code: "item_unavailable", reason: `product not published (${item.product_status ?? "none"})` };
  }
  if (!item.vrepeat_enabled) {
    return { ok: false, code: "item_unavailable", reason: "VelRepeat disabled for product" };
  }
  // shops table has no status column — a joined row implies the shop exists.
  if (item.seller_status && item.seller_status !== "approved" && item.seller_status !== "active") {
    return { ok: false, code: "item_unavailable", reason: `seller not active (${item.seller_status})` };
  }
  if (item.variant_id) {
    if (!item.variant_id_matches) {
      return { ok: false, code: "item_unavailable", reason: "variant does not belong to product" };
    }
    if (!item.variant_status || item.variant_status !== "active") {
      return { ok: false, code: "item_unavailable", reason: `variant not active (${item.variant_status ?? "missing"})` };
    }
    if ((item.variant_stock ?? 0) < item.quantity) {
      return { ok: false, code: "out_of_stock", reason: `variant stock ${item.variant_stock} < ${item.quantity}` };
    }
  } else {
    const available = (item.inv_quantity ?? 0) - (item.inv_reserved ?? 0);
    if (available < item.quantity) {
      return { ok: false, code: "out_of_stock", reason: `inventory ${available} < ${item.quantity}` };
    }
  }
  return { ok: true, code: "ok", reason: "" };
}

/** Current server price for an item (variant price wins when a variant exists). */
export function currentPriceOf(item: any): number {
  if (item.variant_id && item.variant_price != null) return parseFloat(item.variant_price);
  return parseFloat(item.product_price);
}

/**
 * Process ONE due plan inside its own transaction. Returns the run status
 * or null when the plan was claimed by a concurrent worker (idempotent skip).
 */
export async function processPlan(planId: string): Promise<string | null> {
  return withTransaction(async (client: pg.PoolClient) => {
    // ── 1. Claim with row lock + re-check (concurrency guard #1) ───────
    const claimed = await client.query(
      `SELECT id, user_id, frequency_type, interval_value, next_run_at,
              shipping_address_id, shipping_address, payment_method, currency, notes
       FROM velrepeat_plans
       WHERE id = $1 AND status = 'active' AND next_run_at <= NOW()
       FOR UPDATE`,
      [planId],
    );
    if (claimed.rows.length === 0) return null;
    const plan = claimed.rows[0];
    const scheduledFor = new Date(plan.next_run_at);

    // ── 2. Idempotent run creation (concurrency guard #2) ──────────────
    const run = await client.query(
      `INSERT INTO velrepeat_runs (plan_id, scheduled_for, status, started_at)
       VALUES ($1, $2, 'processing', NOW())
       ON CONFLICT (plan_id, scheduled_for) DO NOTHING
       RETURNING id`,
      [plan.id, scheduledFor.toISOString()],
    );
    if (run.rows.length === 0) return null; // already processed by another worker
    const runId = run.rows[0].id as string;

    // ── 3. Load items with live state ──────────────────────────────────
    const itemsRes = await client.query(
      `SELECT vi.id AS item_id, vi.product_id, vi.variant_id, vi.shop_id, vi.seller_id,
              vi.quantity, vi.unit_price AS price_snapshot,
              p.name AS product_name, p.status AS product_status,
              p.vrepeat_enabled, p.price AS product_price,
              pv.status AS variant_status, pv.stock AS variant_stock,
              pv.price AS variant_price,
              (pv.product_id = vi.product_id) AS variant_id_matches,
              sl.status AS seller_status,
              i.quantity AS inv_quantity, i.reserved AS inv_reserved,
              (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order ASC LIMIT 1) AS image_url
       FROM velrepeat_items vi
       JOIN products p ON vi.product_id = p.id
       LEFT JOIN product_variants pv ON vi.variant_id = pv.id
       LEFT JOIN shops sh ON vi.shop_id = sh.id
       LEFT JOIN sellers sl ON vi.seller_id = sl.id
       LEFT JOIN inventory i ON i.product_id = vi.product_id
       WHERE vi.plan_id = $1`,
      [plan.id],
    );
    const items = itemsRes.rows;
    if (items.length === 0) {
      await finishRun(client, runId, "item_unavailable", null, {
        code: "NO_ITEMS",
        message: "Plan has no items",
      });
      await client.query(
        `UPDATE velrepeat_plans SET status = 'cancelled', ended_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [plan.id],
      );
      await insertEvent(client, plan.id, runId, "PLAN_CANCELLED", { reason: "no items" });
      return "item_unavailable";
    }

    // ── 4. Validate every item ─────────────────────────────────────────
    const failures: { itemId: string; code: string; reason: string }[] = [];
    const validated: any[] = [];
    for (const item of items) {
      const v = validatePlanItem(item);
      if (!v.ok) failures.push({ itemId: item.item_id, code: v.code, reason: v.reason });
      else validated.push(item);
    }

    if (failures.length > 0) {
      const codes = new Set(failures.map((f) => f.code));
      const runStatus = codes.has("out_of_stock") ? "out_of_stock" : "item_unavailable";
      await finishRun(client, runId, runStatus, null, {
        code: runStatus.toUpperCase(),
        message: failures.map((f) => `${f.itemId}: ${f.reason}`).join("; "),
      });
      await client.query(
        `UPDATE velrepeat_plans SET status = $1, updated_at = NOW() WHERE id = $2`,
        [runStatus, plan.id],
      );
      await insertEvent(client, plan.id, runId, runStatus === "out_of_stock" ? "OUT_OF_STOCK" : "ITEM_UNAVAILABLE", {
        failures: failures.map((f) => ({ itemId: f.itemId, code: f.code, reason: f.reason })),
      });
      await notifyUser(client, plan.user_id, "velrepeat_out_of_stock", {
        title: "VelRepeat: สินค้าบางรายการไม่พร้อมจัดส่ง",
        message: "สินค้าในแผน VelRepeat ของคุณหมดชั่วคราว — หยุดชั่วคราวไว้ก่อน เมื่อพร้อมแล้วกลับมาดำเนินการต่อได้",
        data: { planId: plan.id },
      });
      return runStatus;
    }

    // ── 5. Resolve shipping address (fresh snapshot when address still exists) ─
    let shippingAddress: string | null = plan.shipping_address
      ? (typeof plan.shipping_address === "string" ? plan.shipping_address : JSON.stringify(plan.shipping_address))
      : null;
    if (plan.shipping_address_id) {
      const addrRes = await client.query(
        `SELECT label, recipient_name, phone, line1, line2, subdistrict, district, state, postal_code, country
         FROM addresses WHERE id = $1`,
        [plan.shipping_address_id],
      );
      if (addrRes.rows.length > 0) {
        const a = addrRes.rows[0];
        shippingAddress = JSON.stringify({
          label: a.label || "Home",
          recipientName: a.recipient_name || "",
          phone: a.phone || "",
          line1: a.line1 || "",
          line2: a.line2 || null,
          subdistrict: a.subdistrict || a.city || null,
          district: a.district || null,
          province: a.state || null,
          postalCode: a.postal_code || null,
          country: a.country || "TH",
        });
      }
    }

    // ── 6. Price policy: never charge a stale price silently ───────────
    // Always use the current server price. If the price moved since the
    // snapshot, record it (event + run metadata + notification) and update
    // the snapshot so it isn't re-flagged every run.
    const priceChanges: { productId: string; name: string; from: number; to: number }[] = [];
    for (const item of validated) {
      const current = currentPriceOf(item);
      const snapshot = parseFloat(item.price_snapshot);
      if (Math.abs(current - snapshot) > 0.001) {
        priceChanges.push({
          productId: item.product_id,
          name: item.product_name,
          from: snapshot,
          to: current,
        });
        await client.query(
          `UPDATE velrepeat_items SET unit_price = $1, updated_at = NOW() WHERE id = $2`,
          [current, item.item_id],
        );
      }
    }

    // ── 7. Create orders (one per shop, mirroring checkout) ────────────
    const shopMap = new Map<string, any[]>();
    for (const item of validated) {
      const shopId = item.shop_id || "unknown";
      const list = shopMap.get(shopId) ?? [];
      list.push(item);
      shopMap.set(shopId, list);
    }

    const orderIds: string[] = [];
    let totalAmount = 0;
    for (const [shopId, shopItems] of shopMap) {
      let orderTotal = 0;
      for (const item of shopItems) {
        orderTotal += currentPriceOf(item) * item.quantity;
      }
      totalAmount += orderTotal;

      const orderRes = await client.query(
        `INSERT INTO orders (user_id, shop_id, status, total_amount, currency,
                             shipping_address_id, shipping_address, notes, velrepeat_run_id)
         VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          plan.user_id,
          shopId === "unknown" ? null : shopId,
          orderTotal,
          plan.currency || "THB",
          plan.shipping_address_id || null,
          shippingAddress,
          plan.notes || `VelRepeat auto-order (plan ${plan.id})`,
          runId,
        ],
      );
      const orderId = orderRes.rows[0].id as string;
      orderIds.push(orderId);

      for (const item of shopItems) {
        const price = currentPriceOf(item);
        const subtotal = price * item.quantity;
        let variantNameSnapshot: string | null = null;
        if (item.variant_id) {
          try {
            const vRes = await client.query(
              `SELECT pv.name AS vname,
                      COALESCE(
                        (SELECT string_agg(pov.label, ' / ' ORDER BY pog.sort_order)
                         FROM product_variant_values pvv
                         JOIN product_option_values pov ON pvv.option_value_id = pov.id
                         JOIN product_option_groups pog ON pov.option_group_id = pog.id
                         WHERE pvv.variant_id = pv.id), ''
                      ) AS option_labels
               FROM product_variants pv WHERE pv.id = $1`,
              [item.variant_id],
            );
            if (vRes.rows[0]) {
              variantNameSnapshot = vRes.rows[0].option_labels || vRes.rows[0].vname || null;
            }
          } catch { /* variant tables may not exist */ }
        }

        await client.query(
          `INSERT INTO order_items (order_id, product_id, shop_id, product_name,
                                    product_name_snapshot, image_url_snapshot, variant_id,
                                    variant_name_snapshot, quantity, price, subtotal)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            orderId, item.product_id, item.shop_id || null,
            item.product_name, item.product_name, item.image_url || null,
            item.variant_id || null, variantNameSnapshot,
            item.quantity, price, subtotal,
          ],
        );

        // Decrement stock atomically (variant-level when present)
        if (item.variant_id) {
          const upd = await client.query(
            `UPDATE product_variants SET stock = stock - $1, updated_at = NOW()
             WHERE id = $2 AND stock >= $1
             RETURNING id`,
            [item.quantity, item.variant_id],
          );
          if (upd.rows.length === 0) {
            throw new Error(`INSUFFICIENT_STOCK: variant ${item.variant_id}`);
          }
        } else {
          // Atomic guarded reservation — same protection as the variant path,
          // so a plan run can never oversell against a concurrent checkout
          // or another plan run. On insufficient stock the throw rolls back
          // this run's transaction; the plan stays active and is retried.
          await reserveInventoryStock(client, item.product_id, item.quantity);
        }
        await client.query(
          `UPDATE products SET sold_count = sold_count + $1 WHERE id = $2`,
          [item.quantity, item.product_id],
        );
      }

      // Payment record (COD by default — the platform's provider)
      await client.query(
        `INSERT INTO payments (order_id, amount, currency, method, status, provider)
         VALUES ($1, $2, $3, 'cod', 'pending', 'cod')`,
        [orderId, orderTotal, plan.currency || "THB"],
      );
    }

    // ── 8. Mark run success + schedule the next run ────────────────────
    const nextRunAt = calculateNextRunAt(new Date(), plan.frequency_type, plan.interval_value);
    await client.query(
      `UPDATE velrepeat_runs
       SET status = 'success', completed_at = NOW(), order_id = $2,
           metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{orderIds}', $3::jsonb)
       WHERE id = $1`,
      [runId, orderIds[0] ?? null, JSON.stringify(orderIds)],
    );
    await client.query(
      `UPDATE velrepeat_plans SET next_run_at = $2, updated_at = NOW() WHERE id = $1`,
      [plan.id, nextRunAt.toISOString()],
    );
    await insertEvent(client, plan.id, runId, "RUN_SUCCESS", {
      orderIds,
      totalAmount,
      priceChanges,
    });

    if (priceChanges.length > 0) {
      await notifyUser(client, plan.user_id, "velrepeat_price_changed", {
        title: "VelRepeat: ราคาสินค้ามีการปรับเปลี่ยน",
        message: "ราคาสินค้าในแผน VelRepeat ของคุณเปลี่ยนไป — ออเดอร์ถัดไปจะคิดราคาใหม่ล่าสุด",
        data: { planId: plan.id, priceChanges },
      });
    } else {
      await notifyUser(client, plan.user_id, "velrepeat_order_created", {
        title: "VelRepeat: สร้างออเดอร์แล้ว",
        message: `ออเดอร์ VelRepeat ของคุณถูกสร้างแล้ว (${orderIds.length} รายการ)`,
        data: { planId: plan.id, orderIds },
      });
    }

    console.log(
      `[velrepeat] run ${runId} success for plan ${plan.id}: orders=${orderIds.length} next=${nextRunAt.toISOString()} priceChanges=${priceChanges.length}`,
    );
    return "success";
  });
}

/** Mark a run as finished (non-success outcomes). */
async function finishRun(
  client: pg.PoolClient,
  runId: string,
  status: string,
  orderId: string | null,
  err: { code: string; message: string },
): Promise<void> {
  await client.query(
    `UPDATE velrepeat_runs
     SET status = $2, completed_at = NOW(), order_id = $3, error_code = $4, error_message = $5
     WHERE id = $1`,
    [runId, status, orderId, err.code, err.message],
  );
}

async function insertEvent(
  client: pg.PoolClient,
  planId: string,
  runId: string | null,
  eventType: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO velrepeat_events (plan_id, run_id, event_type, metadata)
     VALUES ($1, $2, $3, $4)`,
    [planId, runId, eventType, JSON.stringify(metadata)],
  );
}

async function notifyUser(
  client: pg.PoolClient,
  userId: string,
  type: string,
  n: { title: string; message: string; data?: Record<string, unknown> },
): Promise<void> {
  await client.query(
    `INSERT INTO notifications (user_id, type, title, message, data)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, type, n.title, n.message, n.data ? JSON.stringify(n.data) : null],
  );
}

/**
 * Process all currently-due plans. Returns the number of due plans found.
 * Called periodically by the scheduler loop and directly by run-now / tests.
 */
export async function processDuePlans(limit = 25): Promise<{ due: number; processed: string[] }> {
  const due = await query(
    `SELECT id FROM velrepeat_plans
     WHERE status = 'active' AND next_run_at <= NOW()
     ORDER BY next_run_at ASC
     LIMIT $1`,
    [limit],
  );
  const processed: string[] = [];
  for (const row of due.rows) {
    const outcome = await processPlan(row.id as string);
    if (outcome !== null) processed.push(row.id as string);
  }
  return { due: due.rows.length, processed };
}

let running = false;

/**
 * Start the VelRepeat scheduler polling loop. DB is the source of truth;
 * the interval only triggers scans. Safe to run in multiple server
 * instances thanks to row locks + the runs idempotency constraint.
 */
export function startVelRepeatScheduler(intervalMs = 60_000): NodeJS.Timeout {
  const ms = Math.max(10_000, Number(process.env.VELREPEAT_SCHEDULER_INTERVAL_MS) || intervalMs);
  const tick = async () => {
    if (running) return; // never overlap ticks in one process
    running = true;
    try {
      const { due, processed } = await processDuePlans(25);
      if (due > 0) console.log(`[velrepeat] scheduler tick: due=${due} processed=${processed.length}`);
    } catch (err) {
      console.error("[velrepeat] scheduler tick error:", err);
    } finally {
      running = false;
    }
  };
  // Fire once shortly after boot to pick up overdue runs, then poll.
  setTimeout(() => void tick(), 5_000);
  const timer = setInterval(() => void tick(), ms);
  timer.unref?.();
  console.log(`[velrepeat] scheduler started (interval ${ms}ms)`);
  return timer;
}