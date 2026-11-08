/**
 * Tracking normalizer — pure unit tests. No network, no DB.
 */
import { describe, expect, test } from "bun:test";
import {
  JT_STATUS_KEYWORDS,
  FLASH_STATUS_KEYWORDS,
  SPX_STATUS_KEYWORDS,
  TNT_STATUS_KEYWORDS,
  normalizeEventStatus,
  cleanText,
  safeOccurredAt,
  latestEventStatus,
  matchStatus,
} from "../lib/tracking/normalizer.js";

describe("normalizeEventStatus", () => {
  test("J&T Thai statuses map to the unified vocabulary", () => {
    expect(normalizeEventStatus("รับพัสดุแล้ว", JT_STATUS_KEYWORDS).status).toBe("picked_up");
    expect(normalizeEventStatus("อยู่ระหว่างขนส่ง", JT_STATUS_KEYWORDS).status).toBe("in_transit");
    expect(normalizeEventStatus("ส่งถึงแล้ว", JT_STATUS_KEYWORDS).status).toBe("delivered");
    expect(normalizeEventStatus("รอนำส่ง / กำลังนำส่ง", JT_STATUS_KEYWORDS).status).toBe("out_for_delivery");
  });

  test("English + Chinese statuses map too", () => {
    expect(normalizeEventStatus("Out for delivery", JT_STATUS_KEYWORDS).status).toBe("out_for_delivery");
    expect(normalizeEventStatus("已签收", JT_STATUS_KEYWORDS).status).toBe("delivered");
    expect(normalizeEventStatus("揽收", FLASH_STATUS_KEYWORDS).status).toBe("picked_up");
  });

  test("TNT and SPX English statuses map", () => {
    expect(normalizeEventStatus("Shipment collected", TNT_STATUS_KEYWORDS).status).toBe("picked_up");
    expect(normalizeEventStatus("In Transit", TNT_STATUS_KEYWORDS).status).toBe("in_transit");
    expect(normalizeEventStatus("Delivered - Signed for", TNT_STATUS_KEYWORDS).status).toBe("delivered");
    expect(normalizeEventStatus("delivery failed", SPX_STATUS_KEYWORDS).status).toBe("failed");
  });

  test("common stopwords win across carriers (delivery failed)", () => {
    // "จัดส่งไม่สำเร็จ" must map to failed even if the carrier table left it generic.
    expect(matchStatus("จัดส่งไม่สำเร็จ", JT_STATUS_KEYWORDS)).toBe("failed");
  });

  test("unrecognized text becomes unknown and keeps the original", () => {
    const { status, originalStatus } = normalizeEventStatus("Some random hub note 555", TNT_STATUS_KEYWORDS);
    expect(status).toBe("unknown");
    expect(originalStatus).toBe("Some random hub note 555");
  });

  test("empty/null becomes unknown with null original", () => {
    expect(normalizeEventStatus(null, JT_STATUS_KEYWORDS)).toEqual({ status: "unknown", originalStatus: null });
    expect(normalizeEventStatus("   ", JT_STATUS_KEYWORDS)).toEqual({ status: "unknown", originalStatus: null });
  });
});

describe("cleanText (PII stripping)", () => {
  test("strips a Thai phone number", () => {
    const out = cleanText("Arrived at hub. 081-234-5678");
    expect(out).not.toContain("081-234-5678");
    expect(out).toContain("[หมายเลข]");
  });

  test("strips an email address", () => {
    const out = cleanText("contact john@example.com for delivery");
    expect(out).not.toContain("john@example.com");
    expect(out).toContain("[อีเมล]");
  });

  test("collapses whitespace and trims", () => {
    expect(cleanText("  many    spaces   here  ")).toBe("many spaces here");
  });

  test("caps over-long descriptions", () => {
    const long = "x".repeat(1000);
    const out = cleanText(long, 50);
    expect(out!.length).toBe(51); // 50 + ellipsis
    expect(out!.endsWith("…")).toBe(true);
  });

  test("returns null for junk", () => {
    expect(cleanText("")).toBeNull();
    expect(cleanText(null)).toBeNull();
  });
});

describe("safeOccurredAt", () => {
  test("accepts ISO strings, timestamps and Date", () => {
    expect(safeOccurredAt("2026-11-08T10:00:00Z")!.getTime()).toBe(new Date("2026-11-08T10:00:00Z").getTime());
    expect(safeOccurredAt(0)!.getTime()).toBe(0);
    expect(safeOccurredAt(new Date("2026-01-01T00:00:00Z"))!.getTime()).toBe(new Date("2026-01-01T00:00:00Z").getTime());
  });

  test("rejects junk", () => {
    expect(safeOccurredAt("not-a-date")).toBeNull();
    expect(safeOccurredAt("")).toBeNull();
    expect(safeOccurredAt(null)).toBeNull();
    expect(safeOccurredAt(undefined)).toBeNull();
  });
});

describe("latestEventStatus", () => {
  test("most recent event wins", () => {
    const events = [
      { status: "picked_up" as const },
      { status: "delivered" as const },
    ];
    expect(latestEventStatus(events)).toBe("delivered");
  });

  test("empty list is unknown", () => {
    expect(latestEventStatus([])).toBe("unknown");
  });
});
