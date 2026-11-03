/**
 * Order address snapshot reader — regression tests for the defect where the
 * seller order detail showed no address at all.
 *
 * Root cause: `orders.shipping_address` is JSONB, so `pg` returns an object,
 * while both readers only accepted a JSON string and returned null. Every order
 * therefore produced `addressSnapshot: null`; the phone only sometimes appeared
 * because it fell back to the account row.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  normalizeAddressSnapshot,
  orderContact,
  parseShippingAddress,
} from "../lib/order-address.js";

const snapshot = {
  label: "Home",
  recipientName: "สมชาย ใจดี",
  phone: "0812345678",
  line1: "99/1 หมู่ 4",
  line2: null,
  subdistrict: "บางรัก",
  district: "บางรัก",
  province: "กรุงเทพมหานคร",
  postalCode: "10500",
  country: "TH",
};

describe("parseShippingAddress — accepts every representation the driver can return", () => {
  test("already-parsed JSONB object (the regression that blanked the address)", () => {
    expect(parseShippingAddress(snapshot)).toEqual(snapshot);
  });

  test("JSON text form used by older rows/drivers", () => {
    expect(parseShippingAddress(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  test("no address means null, never a fabricated object", () => {
    expect(parseShippingAddress(null)).toBeNull();
    expect(parseShippingAddress(undefined)).toBeNull();
    expect(parseShippingAddress("")).toBeNull();
    expect(parseShippingAddress("   ")).toBeNull();
    expect(parseShippingAddress("not-json{")).toBeNull();
    expect(parseShippingAddress("[]")).toBeNull();
  });
});

describe("normalizeAddressSnapshot — canonical keys, legacy rows still render", () => {
  test("canonical snapshot passes through unchanged", () => {
    const out = normalizeAddressSnapshot(snapshot);
    expect(out?.recipientName).toBe("สมชาย ใจดี");
    expect(out?.phone).toBe("0812345678");
    expect(out?.line1).toBe("99/1 หมู่ 4");
    expect(out?.postalCode).toBe("10500");
  });

  test("legacy snake_case rows map onto the canonical shape", () => {
    const legacy = {
      recipient_name: "Legacy Buyer",
      tel: "0899999999",
      address_line1: "12 Sukhumvit",
      tambon: "คลองตัน",
      amphoe: "คลองเตย",
      state: "กรุงเทพมหานคร",
      postal_code: "10110",
    };
    const out = normalizeAddressSnapshot(legacy);
    expect(out?.recipientName).toBe("Legacy Buyer");
    expect(out?.phone).toBe("0899999999");
    expect(out?.line1).toBe("12 Sukhumvit");
    expect(out?.subdistrict).toBe("คลองตัน");
    expect(out?.district).toBe("คลองเตย");
    expect(out?.province).toBe("กรุงเทพมหานคร");
    expect(out?.postalCode).toBe("10110");
  });

  test("canonical value wins over a legacy duplicate", () => {
    const out = normalizeAddressSnapshot({
      phone: "0800000000",
      tel: "0899999999",
    });
    expect(out?.phone).toBe("0800000000");
  });

  test("blank canonical field falls back to the legacy field", () => {
    const out = normalizeAddressSnapshot({ recipientName: "   ", recipient_name: "Fallback" });
    expect(out?.recipientName).toBe("Fallback");
  });

  test("absent data stays absent — nothing is invented", () => {
    const out = normalizeAddressSnapshot({ line1: "only a street" });
    expect(out?.line1).toBe("only a street");
    expect(out?.phone).toBeUndefined();
    expect(out?.province).toBeUndefined();
    expect(normalizeAddressSnapshot(null)).toBeNull();
  });
});

describe("orderContact — seller ships to the order snapshot, not the live profile", () => {
  test("snapshot recipient and phone win", () => {
    expect(orderContact(snapshot, { name: "โปรไฟล์ใหม่", phone: "0000000000" })).toEqual({
      name: "สมชาย ใจดี",
      phone: "0812345678",
    });
  });

  test("account row is only a fallback for legacy orders", () => {
    expect(orderContact({ line1: "x" }, { name: "Account", phone: "0811111111" })).toEqual({
      name: "Account",
      phone: "0811111111",
    });
  });

  test("blank snapshot values do not shadow the account row", () => {
    expect(orderContact({ recipientName: "  ", phone: "" }, { name: "A", phone: "0822222222" })).toEqual({
      name: "A",
      phone: "0822222222",
    });
  });

  test("nothing anywhere yields nulls, not empty strings", () => {
    expect(orderContact(null, undefined)).toEqual({ name: null, phone: null });
  });
});

describe("no route keeps the string-only reader", () => {
  const root = join(import.meta.dir, "..", "..");
  const read = (p: string) => readFileSync(join(root, p), "utf8");

  test("seller orders and customer cart both use the shared normalizer", () => {
    const seller = read("backend/routes/seller-orders.ts");
    const cart = read("backend/routes/cart.ts");
    expect(seller).toContain("normalizeAddressSnapshot(");
    expect(cart).toContain("normalizeAddressSnapshot(");
    // The old local copies must be gone.
    expect(seller).not.toContain("typeof raw !== \"string\"");
    expect(cart).not.toContain("typeof raw !== \"string\"");
  });
});
