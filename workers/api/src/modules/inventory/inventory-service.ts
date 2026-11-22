import type { IDatabaseClient } from "../../core/database/db-client.js";

export interface ReserveItemInput {
  productId: string;
  variantId?: string | null;
  quantity: number;
}

export interface InventoryReservationRecord {
  id: string;
  productId: string;
  variantId?: string | null;
  orderId?: string | null;
  quantity: number;
  status: "reserved" | "committed" | "released";
  expiresAt: string;
  createdAt: string;
}

export class InventoryService {
  private inMemoryReservations: Map<string, InventoryReservationRecord> = new Map();

  constructor(private readonly db?: IDatabaseClient) {}

  async reserveStock(
    items: ReserveItemInput[],
    orderId?: string,
    ttlMinutes = 15,
  ): Promise<InventoryReservationRecord[]> {
    const reservations: InventoryReservationRecord[] = [];
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString();

    if (this.db) {
      return this.db.transaction(async (tx: IDatabaseClient) => {
        for (const item of items) {
          // Check available stock using pessimistic row lock
          const prodRes = await tx.query<any>(
            `SELECT id, total_quantity as "totalQuantity", reserved_quantity as "reservedQuantity"
             FROM products WHERE id = $1 FOR UPDATE`,
            [item.productId],
          );

          if (prodRes.rows.length === 0) {
            throw new Error(`Product ${item.productId} not found`);
          }

          const product = prodRes.rows[0];
          const available = product.totalQuantity - product.reservedQuantity;
          if (available < item.quantity) {
            throw new Error(
              `Insufficient stock for product ${item.productId}. Requested ${item.quantity}, available ${available}`,
            );
          }

          // Increment reserved_quantity
          await tx.query(
            `UPDATE products SET reserved_quantity = reserved_quantity + $1, updated_at = NOW()
             WHERE id = $2`,
            [item.quantity, item.productId],
          );

          // Insert reservation
          const resId = crypto.randomUUID();
          await tx.query(
            `INSERT INTO inventory_reservations (id, product_id, variant_id, order_id, quantity, status, expires_at, created_at)
             VALUES ($1, $2, $3, $4, $5, 'reserved', $6, NOW())`,
            [resId, item.productId, item.variantId || null, orderId || null, item.quantity, expiresAt],
          );

          reservations.push({
            id: resId,
            productId: item.productId,
            variantId: item.variantId || null,
            orderId: orderId || null,
            quantity: item.quantity,
            status: "reserved",
            expiresAt,
            createdAt: now.toISOString(),
          });
        }
        return reservations;
      });
    }

    // Mock In-Memory Implementation
    for (const item of items) {
      const resId = crypto.randomUUID();
      const rec: InventoryReservationRecord = {
        id: resId,
        productId: item.productId,
        variantId: item.variantId || null,
        orderId: orderId || null,
        quantity: item.quantity,
        status: "reserved",
        expiresAt,
        createdAt: now.toISOString(),
      };
      this.inMemoryReservations.set(resId, rec);
      reservations.push(rec);
    }
    return reservations;
  }

  async commitReservation(orderId: string): Promise<void> {
    if (this.db) {
      await this.db.transaction(async (tx: IDatabaseClient) => {
        const reservations = await tx.query<any>(
          `SELECT id, product_id as "productId", quantity FROM inventory_reservations
           WHERE order_id = $1 AND status = 'reserved'`,
          [orderId],
        );

        for (const r of reservations.rows) {
          // Deduct from total_quantity and reserved_quantity
          await tx.query(
            `UPDATE products
             SET total_quantity = total_quantity - $1,
                 reserved_quantity = reserved_quantity - $1,
                 updated_at = NOW()
             WHERE id = $2`,
            [r.quantity, r.productId],
          );
        }

        await tx.query(
          `UPDATE inventory_reservations SET status = 'committed' WHERE order_id = $1 AND status = 'reserved'`,
          [orderId],
        );
      });
      return;
    }

    // In-memory
    for (const rec of this.inMemoryReservations.values()) {
      if (rec.orderId === orderId && rec.status === "reserved") {
        rec.status = "committed";
      }
    }
  }

  async releaseReservation(orderId: string): Promise<void> {
    if (this.db) {
      await this.db.transaction(async (tx: IDatabaseClient) => {
        const reservations = await tx.query<any>(
          `SELECT id, product_id as "productId", quantity FROM inventory_reservations
           WHERE order_id = $1 AND status = 'reserved'`,
          [orderId],
        );

        for (const r of reservations.rows) {
          // Release reserved_quantity back to available pool
          await tx.query(
            `UPDATE products SET reserved_quantity = reserved_quantity - $1, updated_at = NOW()
             WHERE id = $2`,
            [r.quantity, r.productId],
          );
        }

        await tx.query(
          `UPDATE inventory_reservations SET status = 'released' WHERE order_id = $1 AND status = 'reserved'`,
          [orderId],
        );
      });
      return;
    }

    // In-memory
    for (const rec of this.inMemoryReservations.values()) {
      if (rec.orderId === orderId && rec.status === "reserved") {
        rec.status = "released";
      }
    }
  }
}
