/**
 * Order-lifecycle notification ROWS — the ONE writer.
 *
 * The notification system already exists (`notifications` table,
 * `GET /api/customer/notifications`, `PATCH …/:id/read`,
 * `PUT …/read-all`, both bell dropdowns). This module does not add a second one:
 * it is where the order/payment/shipment transitions that used to leave no
 * trace now write their row.
 *
 * THE ORDER THAT MATTERS
 * ----------------------
 *   1. the business mutation commits,
 *   2. the notification ROW is inserted,
 *   3. the realtime signal (`notification:created`) is pushed to the recipient's
 *      own `user:{id}` channel.
 *
 * The ROW is the record; the socket frame is only a nudge for the bell to
 * re-read. A dropped frame therefore loses nothing, and nothing here may run
 * before the mutation commits — a rolled-back order leaves no notification
 * behind.
 *
 * IDEMPOTENCY
 * -----------
 * `notifications` has no unique business key, and this phase adds none (no
 * schema change). Duplicate rows are prevented the way the state machines
 * already prevent duplicate transitions: every caller notifies only after a
 * REAL change — `moved === true`, a freshly created order, a replayed checkout
 * request that created nothing. A retry of the same request therefore reaches
 * neither the transition nor this module.
 *
 * Rows are written with the SAME copy style as the existing ones (Thai title +
 * message, structured `data` payload the bells navigate with), and a failure is
 * logged and swallowed: a notification write must never fail a committed sale.
 */
import { query } from "../db/index.js";
import { CHANNELS, sendToUser } from "../realtime/index.js";
import { resolveOrderParties } from "./order-events.js";

/** Notification families the two bells map to icons. */
type NotificationType = "order" | "payment" | "shipping";

interface Copy {
  type: NotificationType;
  title: string;
  message: string;
}

/**
 * Copy for a change of the ORDER's own status. Payment states live on the same
 * column (the legacy projection) and are classified as `payment` so the
 * customer's bell shows the card icon rather than a generic package.
 * `{order}` is replaced with the order number when the row has one.
 */
const ORDER_STATUS_COPY: Record<string, Copy> = {
  confirmed: { type: "order", title: "ออเดอร์ได้รับการยืนยัน", message: "{order} ได้รับการยืนยันจากผู้ขายแล้ว" },
  packing: { type: "order", title: "ผู้ขายกำลังเตรียมสินค้า", message: "{order} กำลังถูกจัดเตรียมเพื่อจัดส่ง" },
  shipped: { type: "shipping", title: "ออเดอร์ถูกจัดส่งแล้ว", message: "{order} อยู่ระหว่างการขนส่ง" },
  delivered: { type: "shipping", title: "ออเดอร์ส่งถึงแล้ว", message: "{order} ส่งถึงคุณเรียบร้อยแล้ว" },
  completed: { type: "order", title: "ออเดอร์เสร็จสมบูรณ์", message: "{order} เสร็จสมบูรณ์ ขอบคุณที่อุดหนุน" },
  cancelled: { type: "order", title: "ออเดอร์ถูกยกเลิก", message: "{order} ถูกยกเลิกแล้ว" },
  refunded: { type: "payment", title: "คืนเงินแล้ว", message: "เงินสำหรับ {order} ถูกคืนเรียบร้อยแล้ว" },
  paid: { type: "payment", title: "ชำระเงินสำเร็จ", message: "การชำระเงินของ {order} ได้รับการยืนยันแล้ว" },
  pending_payment: {
    type: "payment",
    title: "รอการชำระเงิน",
    message: "{order} ยังไม่ได้รับการชำระเงิน กรุณาชำระเงินก่อนหมดเวลา",
  },
  payment_failed: {
    type: "payment",
    title: "ชำระเงินไม่สำเร็จ",
    message: "การชำระเงินของ {order} ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
  },
  expired: {
    type: "payment",
    title: "หมดเวลาชำระเงิน",
    message: "{order} ถูกยกเลิกเนื่องจากหมดเวลาชำระเงินและคืนสินค้าเข้าระบบแล้ว",
  },
};

/** Copy for a change of the PARCEL's status (`shipments.status`). */
const SHIPMENT_STATUS_COPY: Record<string, Copy> = {
  created: { type: "shipping", title: "ผู้ขายสร้างพัสดุแล้ว", message: "พัสดุของ {order} ถูกสร้างแล้ว" },
  picked_up: { type: "shipping", title: "พัสดุถูกเข้ารับแล้ว", message: "พัสดุของ {order} อยู่กับผู้ให้บริการขนส่งแล้ว" },
  in_transit: { type: "shipping", title: "พัสดุกำลังขนส่ง", message: "พัสดุของ {order} กำลังเดินทาง" },
  out_for_delivery: { type: "shipping", title: "พัสดุกำลังนำจ่าย", message: "พัสดุของ {order} กำลังนำจ่ายถึงคุณ" },
  delivered: { type: "shipping", title: "พัสดุส่งถึงแล้ว", message: "พัสดุของ {order} ส่งถึงคุณเรียบร้อยแล้ว" },
  cancelled: { type: "shipping", title: "การจัดส่งถูกยกเลิก", message: "การจัดส่งของ {order} ถูกยกเลิก" },
  lost: { type: "shipping", title: "พัสดุสูญหาย", message: "พัสดุของ {order} ถูกรายงานว่าสูญหาย" },
};

/** Fallback for a real transition that has no dedicated copy yet. */
const GENERIC_ORDER_COPY: Copy = {
  type: "order",
  title: "ออเดอร์ของคุณมีการอัปเดต",
  message: "สถานะของ {order} มีการเปลี่ยนแปลง",
};

/** Replace the `{order}` placeholder with the order's reference (or a neutral phrase). */
function fill(copy: Copy, orderNumber: string | null): Copy {
  const label = orderNumber ? `คำสั่งซื้อ ${orderNumber}` : "คำสั่งซื้อของคุณ";
  return {
    type: copy.type,
    title: copy.title,
    message: copy.message.replaceAll("{order}", label),
  };
}

/**
 * Insert ONE notification row for a recipient and push the matching realtime
 * signal to that user's own connections. Never throws.
 */
async function notifyUser(
  recipientUserId: string,
  copy: Copy,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    const res = await query(
      `INSERT INTO notifications (user_id, type, title, message, data)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [recipientUserId, copy.type, copy.title, copy.message, JSON.stringify(data)],
    );
    // The row exists by now — the frame only tells the bell to re-read it.
    sendToUser(recipientUserId, "", CHANNELS.NOTIFICATION_CREATED, {
      id: res.rows[0]?.id ?? null,
      type: copy.type,
      title: copy.title,
      message: copy.message,
    });
  } catch (err) {
    console.warn(
      "[order-notifications] write failed (non-fatal):",
      err instanceof Error ? err.message : err,
    );
  }
}

/** Resolve the order's parties once and notify one of them. */
async function notifyParty(
  orderId: string,
  audience: "customer" | "seller",
  build: (orderNumber: string | null) => Copy,
): Promise<void> {
  if (!orderId) return;
  try {
    const parties = await resolveOrderParties(orderId);
    const recipient = audience === "customer" ? parties.customerId : parties.sellerUserId;
    if (!recipient) return;
    await notifyUser(recipient, build(parties.orderNumber), { orderId });
  } catch (err) {
    // A failed lookup is a missing notification, never a failed sale.
    console.warn(
      "[order-notifications] recipient lookup failed (non-fatal):",
      err instanceof Error ? err.message : err,
    );
  }
}

/** The customer's order status changed (payment states included). */
export async function notifyOrderCustomerOfStatus(orderId: string, status: string): Promise<void> {
  const copy = ORDER_STATUS_COPY[status] ?? GENERIC_ORDER_COPY;
  await notifyParty(orderId, "customer", (orderNumber) => fill(copy, orderNumber));
}

/** The customer's parcel moved. */
export async function notifyOrderCustomerOfShipment(
  orderId: string,
  shipmentStatus: string,
): Promise<void> {
  const copy = SHIPMENT_STATUS_COPY[shipmentStatus] ?? GENERIC_ORDER_COPY;
  await notifyParty(orderId, "customer", (orderNumber) => fill(copy, orderNumber));
}

/** A new order arrived for the shop's seller. */
export async function notifyOrderSellerOfNewOrder(orderId: string): Promise<void> {
  await notifyParty(orderId, "seller", (orderNumber) =>
    fill(
      {
        type: "order",
        title: "มีคำสั่งซื้อใหม่",
        message: "ลูกค้าได้สั่งซื้อสินค้าจาก {order} กรุณาตรวจสอบและยืนยันออเดอร์",
      },
      orderNumber,
    ),
  );
}

/** An order was cancelled (by the customer, before payment). */
export async function notifyOrderSellerOfCancellation(orderId: string): Promise<void> {
  await notifyParty(orderId, "seller", (orderNumber) =>
    fill(
      {
        type: "order",
        title: "คำสั่งซื้อถูกยกเลิก",
        message: "ลูกค้ายกเลิก {order} ก่อนการชำระเงิน",
      },
      orderNumber,
    ),
  );
}
