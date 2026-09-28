/**
 * Order read helpers — item/shipment projection used by the customer order
 * endpoints.
 *
 * These two functions were defined inline in `routes/cart.ts`, which had grown
 * past 70 KB and made route handlers hard to find. They are pure readers (no
 * writes, no transaction, no business state) so they move out with no behaviour
 * change at all: the same SQL, the same shapes, the same defensive `catch`
 * blocks for legacy databases without the variant / tracking tables.
 *
 * They remain the ONLY readers of these projections — `routes/cart.ts` imports
 * them, and no second copy may be created.
 */
import { query } from "../db/index.js";

/**
 * Resolve order item display data (snapshot-first) for one or more orders.
 *
 * Image priority: purchased snapshot → current variant image → product gallery.
 * Variant name priority: purchased snapshot → current option labels → variant name.
 * Products are LEFT JOINed so deleted/unpublished products never break the order view.
 */
export async function fetchOrderItemsForOrders(orderIds: string[]): Promise<Record<string, any[]>> {
  if (orderIds.length === 0) return {};

  const itemsRes = await query(
    `SELECT oi.id, oi.order_id, oi.product_id, oi.shop_id, oi.variant_id,
            oi.quantity, oi.price, oi.subtotal,
            COALESCE(NULLIF(oi.product_name_snapshot, ''), NULLIF(oi.product_name, ''), p.name, '') AS product_name,
            oi.variant_name_snapshot AS variant_name_snapshot,
            COALESCE(oi.image_url_snapshot,
                     (SELECT url FROM product_images WHERE product_id = oi.product_id ORDER BY sort_order ASC LIMIT 1)) AS image_url,
            p.unit AS unit, p.status AS product_status
     FROM order_items oi
     LEFT JOIN products p ON oi.product_id = p.id
     WHERE oi.order_id = ANY($1)
     ORDER BY oi.created_at ASC`,
    [orderIds],
  );

  // Resolve current variant names + images for items whose snapshot is missing
  // (backward compatibility for orders created before snapshots were stored).
  const variantIds = [...new Set(itemsRes.rows.map((r: any) => r.variant_id).filter(Boolean))];
  const variantMap = new Map<string, { name: string; image: string | null; labels: string | null }>();
  if (variantIds.length > 0) {
    try {
      const varRes = await query(
        `SELECT pv.id AS variant_id, pv.name,
                (SELECT url FROM product_variant_images WHERE variant_id = pv.id ORDER BY sort_order ASC LIMIT 1) AS variant_image,
                (SELECT string_agg(pov.label, ' / ' ORDER BY pog.sort_order)
                 FROM product_variant_values pvv
                 JOIN product_option_values pov ON pvv.option_value_id = pov.id
                 JOIN product_option_groups pog ON pov.option_group_id = pog.id
                 WHERE pvv.variant_id = pv.id) AS option_labels
         FROM product_variants pv
         WHERE pv.id = ANY($1)`,
        [variantIds],
      );
      for (const row of varRes.rows) {
        variantMap.set(row.variant_id, { name: row.name, image: row.variant_image, labels: row.option_labels });
      }
    } catch {
      // Variant tables may not exist on legacy databases — snapshots already cover most cases.
    }
  }

  const byOrder = new Map<string, any[]>();
  for (const r of itemsRes.rows) {
    const variant = r.variant_id ? variantMap.get(r.variant_id) : null;
    const variantName = r.variant_name_snapshot || variant?.labels || variant?.name || null;
    const imageUrl = r.image_url || variant?.image || null;
    const unitPrice = parseFloat(r.price) || 0;
    const item = {
      id: r.id,
      orderId: r.order_id,
      productId: r.product_id,
      shopId: r.shop_id,
      variantId: r.variant_id,
      productName: r.product_name || "สินค้า",
      unit: r.unit ?? "",
      unitPrice,
      price: unitPrice,
      quantity: r.quantity,
      subtotal: parseFloat(r.subtotal) || unitPrice * r.quantity,
      variantName,
      imageUrl,
      productStatus: r.product_status,
    };
    const list = byOrder.get(r.order_id) ?? [];
    list.push(item);
    byOrder.set(r.order_id, list);
  }
  return Object.fromEntries(byOrder);
}

/**
 * Load shipments for an order with their tracking events.
 * Tracking events are read defensively so legacy DBs without the table
 * still return shipments (events just empty).
 */
export async function fetchShipmentsForOrder(orderId: string): Promise<any[]> {
  const sRes = await query(
    `SELECT s.id, s.carrier, s.tracking_number, s.status, s.estimated_delivery_date
     FROM shipments s
     WHERE s.order_id = $1
     ORDER BY s.created_at DESC`,
    [orderId],
  );
  const shipments = sRes.rows.map((r: any) => ({
    id: r.id,
    carrier: r.carrier,
    trackingNumber: r.tracking_number,
    status: r.status,
    estimatedDeliveryDate: r.estimated_delivery_date,
    events: [] as any[],
  }));
  if (shipments.length === 0) return shipments;
  try {
    const eventsRes = await query(
      `SELECT te.id, te.shipment_id, te.status, te.description, te.location, te.occurred_at
       FROM tracking_events te
       WHERE te.shipment_id = ANY($1)
       ORDER BY te.occurred_at ASC`,
      [shipments.map((s) => s.id)],
    );
    const byShipment = new Map<string, any[]>();
    for (const e of eventsRes.rows) {
      const list = byShipment.get(e.shipment_id) ?? [];
      list.push({
        id: e.id,
        status: e.status,
        description: e.description,
        location: e.location,
        occurredAt: e.occurred_at,
      });
      byShipment.set(e.shipment_id, list);
    }
    for (const s of shipments) s.events = byShipment.get(s.id) ?? [];
  } catch {
    // tracking_events may not exist on legacy databases.
  }
  return shipments;
}
