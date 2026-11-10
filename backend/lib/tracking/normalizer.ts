/**
 * Tracking normalizer — carrier raw status → unified vocabulary.
 *
 * Every carrier words its statuses differently (Thai/English/Chinese), so each
 * adapter maps its own raw strings through per-carrier keyword tables below.
 * The result ONLY ever uses the unified `TrackedEventStatus` vocabulary, while
 * the raw original is preserved on the event (`carrier_status`) and the
 * shipment (`original_status`) so no carrier-specific information is lost.
 *
 * Sanitizing: carrier descriptions/locations routinely carry names and phone
 * numbers. The task rule is "ห้ามเก็บข้อมูลส่วนบุคคลเกินความจำเป็น" — we strip
 * phone numbers, emails and control/stray whitespace and cap length before a
 * string is persisted or returned.
 */
import type { TrackedEventStatus } from "./types.js";

export type StatusKeywordTable = Partial<Record<TrackedEventStatus, string[]>>;

/**
 * A status wins if any of its keywords appear in the raw text (case-insensitive,
 * substring match). Earlier table keys win on ties (more specific first).
 */
export function matchStatus(raw: string, table: StatusKeywordTable): TrackedEventStatus {
  const text = (raw ?? "").toLowerCase();
  if (!text) return "unknown";
  const order: TrackedEventStatus[] = [
    "delivered",
    "failed",
    "returning",
    "returned",
    "cancelled",
    "lost",
    "out_for_delivery",
    "arrived_at_hub",
    "picked_up",
    "created",
    "in_transit",
    "info",
    "unknown",
  ];
  for (const status of order) {
    const words = table[status];
    if (!words) continue;
    for (const w of words) {
      if (text.includes(w.toLowerCase())) return status;
    }
  }
  return "unknown";
}

/** Shared keywords useful to any carrier (handled before carrier tables). */
const COMMON_STOPWORDS: StatusKeywordTable = {
  delivered: ["successfully delivered", "delivered", "đã giao", "送达", "已签收", "ส่งถึง", "จัดส่งสำเร็จ", "สินค้าถึงมือ", "delivery completed"],
  failed: ["undeliverable", "delivery failed", "failed delivery", "จัดส่งไม่สำเร็จ", "ไม่สำเร็จ", "cannot be delivered", "address incorrect", "ที่อยู่ไม่ถูกต้อง", "ปิดที่อยู่", "ส่งไม่สำเร็จ"],
  returning: ["being returned", "returns in progress", "returning", "การส่งคืน", "จัดส่งคืน", "กำลังส่งกลับ"],
  returned: ["returned", "已退回", "ส่งคืนแล้ว", "return completed"],
  cancelled: ["cancelled", "canceled", "取消", "ยกเลิก"],
  lost: ["lost", "遗失", "ไม่พบพัสดุ", "ได ขั้นหาย"],
};

/** Keyword tables per carrier (Thai + English). Order in the table matters per `matchStatus`. */
export const JT_STATUS_KEYWORDS: StatusKeywordTable = {
  out_for_delivery: ["กำลังนำส่ง", "out for delivery", "派送中", "กำลังจัดส่งถึง"],
  arrived_at_hub: ["ถึงศูนย์", "ถึงปลายทาง", "ถึงสาขา", "arrived at", "到达转运中心", "中心"],
  picked_up: ["รับพัสดุแล้ว", "เจ้าหน้าที่รับพัสดุ", "รับพัสดุ", "picked up", "揽收", "已揽收"],
  created: ["สร้างใบสั่ง", "ข้อมูลถูกสร้าง", "created", "已下单"],
  in_transit: ["อยู่ระหว่าง", "ขนส่ง", "in transit", "运输中", "途中", "รอนำส่ง"],
  delivered: ["ส่งถึงแล้ว", "จัดส่งสำเร็จ", "delivered", "已签收"],
  failed: ["จัดส่งไม่สำเร็จ", "ส่งไม่สำเร็จ", "failed"],
  returning: ["ส่งคืน", "return"],
  cancelled: ["ยกเลิก", "cancelled"],
};

export const FLASH_STATUS_KEYWORDS: StatusKeywordTable = {
  out_for_delivery: ["กำลังนำส่ง", "out for delivery", "นำส่ง", "派送中"],
  arrived_at_hub: ["ถึงศูนย์คัดแยก", "ถึงคลัง", "arrived at", "到件", "中心仓"],
  picked_up: ["รับพัสดุ", "จัดส่งเรียกพัสดุ", "picked up", "揽收"],
  created: ["สร้างการจัดส่ง", "created", "已下单"],
  in_transit: ["ขนส่ง", "in transit", "途中", "中转"],
  delivered: ["ส่งสำเร็จ", "delivered", "已签收"],
  failed: ["จัดส่งไม่สำเร็จ", "failed"],
  returning: ["ส่งคืน", "return"],
};

export const SPX_STATUS_KEYWORDS: StatusKeywordTable = {
  out_for_delivery: ["out for delivery", "กำลังนำส่ง", "นำส่ง", "派送中"],
  arrived_at_hub: ["arrived at", "到达", "hub"],
  picked_up: ["picked up", "揽收", "รับพัสดุ"],
  created: ["created", "order created", "已下单"],
  in_transit: ["in transit", "in-transit", "transport", "运输中", "ขนส่ง"],
  delivered: ["delivered", "已签收", "ส่งถึง"],
  failed: ["failed", "delivery failed", "จัดส่งไม่สำเร็จ"],
};

export const TNT_STATUS_KEYWORDS: StatusKeywordTable = {
  out_for_delivery: ["out for delivery", "with delivery courier"],
  arrived_at_hub: ["arrived at", "at depot", "at facility", "sorted at"],
  picked_up: ["collected", "picked up", "shipment collected"],
  created: ["registered", "created", "booking made", "label created"],
  in_transit: ["in transit", "departed", "on trailer", "en route"],
  delivered: ["delivered", "signed for"],
  failed: ["undeliverable", "delivery attempted", "not delivered"],
  returning: ["return to sender", "being returned"],
  returned: ["returned"],
};

export const KERRY_STATUS_KEYWORDS: StatusKeywordTable = {
  out_for_delivery: ["กำลังนำส่ง", "out for delivery", "นำส่ง", "on the way"],
  arrived_at_hub: ["ถึงศูนย์", "ถึงสาขา", "arrived at", "at branch", "at hub"],
  picked_up: ["รับพัสดุ", "picked up", "collected", "รับสินค้า"],
  created: ["สร้างรายการ", "created", "received order", "รับออเดอร์"],
  in_transit: ["อยู่ระหว่างขนส่ง", "in transit", "ขนส่ง", "transit"],
  delivered: ["ส่งถึงแล้ว", "delivered", "จัดส่งสำเร็จ"],
  failed: ["จัดส่งไม่สำเร็จ", "failed", "cannot deliver", "ปฏิเสธ"],
  returning: ["ส่งคืน", "returning", "return to sender"],
  returned: ["ส่งคืนแล้ว", "returned"],
};

export const THAILANDPOST_STATUS_KEYWORDS: StatusKeywordTable = {
  out_for_delivery: ["นำจ่าย", "out for delivery", "อยู่ระหว่างนำจ่าย"],
  arrived_at_hub: ["ถึงที่ทำการ", "arrived at", "รับเข้าระบบ", "เข้าในระบบ"],
  picked_up: ["รับฝาก", "picked up", "collected", "ฝากส่ง"],
  created: ["สร้างรายการ", "created", "รับข้อมูล"],
  in_transit: ["อยู่ระหว่างการขนส่ง", "ระหว่างขนส่ง", "in transit", "ส่งต่อ"],
  delivered: ["นำจ่ายสำเร็จ", "delivered", "ผู้รับได้รับ", "สำเร็จ"],
  failed: ["นำจ่ายไม่สำเร็จ", "ไม่สำเร็จ", "failed", "ตีกลับ"],
  returning: ["ส่งคืน", "ตีกลับ", "returning"],
  returned: ["ส่งคืนแล้ว", "returned"],
};

/**
 * Map one raw carrier status string to the unified vocabulary, keeping the raw
 * text. `table` is the carrier's keyword table; `common` keywords run first.
 */
export function normalizeEventStatus(raw: string | null, table: StatusKeywordTable): {
  status: TrackedEventStatus;
  originalStatus: string | null;
} {
  const original = cleanText(raw);
  if (!original) return { status: "unknown", originalStatus: null };
  const common = matchStatus(original, COMMON_STOPWORDS);
  const status = common === "unknown" ? matchStatus(original, table) : common;
  return { status, originalStatus: original };
}

/** Derive the shipment's "current" status from its events (most recent wins). */
export function latestEventStatus(events: { status: TrackedEventStatus }[]): TrackedEventStatus {
  if (events.length === 0) return "unknown";
  return events[events.length - 1]!.status;
}

// ─── Sanitizing ──────────────────────────────────────────────────────────────

const PHONE_RE = /(\+?\d[\d\s\-()]{7,}\d)/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const WHITESPACE_RE = /\s+/g;
/** Cap event text lengths so one carrier quirk never bloats a row. */
const MAX_DESC = 500;
const MAX_LOC = 200;

/** Clean a carrier-supplied string: strip PII + stray whitespace, cap length. */
export function cleanText(value: string | null | undefined, cap = MAX_DESC): string | null {
  if (typeof value !== "string") return null;
  const stripped = value.replace(PHONE_RE, "[หมายเลข]").replace(EMAIL_RE, "[อีเมล]").replace(WHITESPACE_RE, " ").trim();
  if (!stripped) return null;
  return stripped.length > cap ? `${stripped.slice(0, cap)}…` : stripped;
}

/** Ensure an occurredAt is a valid Date or null (defensive against carrier junk). */
export function safeOccurredAt(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}
