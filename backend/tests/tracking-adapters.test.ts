/**
 * Tracking carrier adapters — every adapter with a STUBBED global fetch.
 *
 * No real network: each test replaces `globalThis.fetch` with the exact body a
 * carrier was observed to return (2026-11-08 verification) or the shape we
 * expect, then asserts the adapter's normalized result. This is the only place
 * mocks may be used — production adapters always perform the real call.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { jtExpressAdapter } from "../lib/tracking/carriers/jt.js";
import { flashExpressAdapter } from "../lib/tracking/carriers/flash.js";
import { spxExpressAdapter } from "../lib/tracking/carriers/spx.js";
import { tntExpressAdapter } from "../lib/tracking/carriers/tnt.js";

function stubFetch(status: number, body: string, headers: Record<string, string> = { "content-type": "application/json" }) {
  const res = new Response(body, { status, headers });
  (globalThis as any).__fetch = globalThis.fetch;
  globalThis.fetch = async () => res;
}

afterEach(() => {
  if ((globalThis as any).__fetch) {
    globalThis.fetch = (globalThis as any).__fetch;
    delete (globalThis as any).__fetch;
  }
});

function jsonResponse(body: unknown) {
  stubFetch(200, JSON.stringify(body));
}

describe("number format validation", () => {
  test("JT accepts TH + digits and bare digits, rejects junk", () => {
    expect(jtExpressAdapter.validate("TH1234567890123")).toBe(true);
    expect(jtExpressAdapter.validate("1234567890123")).toBe(true);
    expect(jtExpressAdapter.validate("abc")).toBe(false);
    expect(jtExpressAdapter.validate("")).toBe(false);
  });

  test("SPX accepts 12-16 digits only", () => {
    expect(spxExpressAdapter.validate("9980189359167")).toBe(true);
    expect(spxExpressAdapter.validate("TH1234567890123")).toBe(false);
  });

  test("TNT accepts alphanumeric CON range", () => {
    expect(tntExpressAdapter.validate("856719638")).toBe(true);
    expect(tntExpressAdapter.validate("AE1B2C3D4")).toBe(true);
    expect(tntExpressAdapter.validate("abc")).toBe(false);
  });

  test("Flash accepts digits and letter-prefixed codes", () => {
    expect(flashExpressAdapter.validate("1234567890123")).toBe(true);
    expect(flashExpressAdapter.validate("FX12345678")).toBe(true);
  });
});

describe("J&T adapter", () => {
  test("captcha response (code 20005) → BLOCKED, not fabricated", async () => {
    jsonResponse({ code: 20005, msg: "验证码不正确", data: null, fail: true, succ: false });
    const out = await jtExpressAdapter.fetch({ trackingNumber: "TH1234567890123" });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.code).toBe("BLOCKED");
      expect(out.error.retryable).toBe(false);
    }
  });

  test("a successful details payload parses events in order", async () => {
    jsonResponse({
      code: 0,
      msg: "OK",
      data: {
        status: "ส่งถึงแล้ว",
        details: [
          { desc: "รับพัสดุแล้ว", facilityName: "สาขาสาทร", time: "2026-11-06T09:00:00Z" },
          { desc: "ส่งถึงแล้ว", facilityName: "ปลายทาง", time: "2026-11-07T12:30:00Z" },
        ],
      },
    });
    const out = await jtExpressAdapter.fetch({ trackingNumber: "TH1234567890123" });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.currentStatus).toBe("delivered");
      expect(out.events).toHaveLength(2);
      expect(out.events[0]!.status).toBe("picked_up");
      expect(out.events[1]!.status).toBe("delivered");
      expect(out.confirmed).toBe(true);
    }
  });
});

describe("Flash adapter", () => {
  test("anti-bot HTML shield → BLOCKED", async () => {
    stubFetch(200, "<!DOCTYPE html><html><head><title>5 Second Shield</title></head><body>Browser security check</body></html>", { "content-type": "text/html" });
    const out = await flashExpressAdapter.fetch({ trackingNumber: "1234567890123" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe("BLOCKED");
  });

  test("JSON tracking payload parses", async () => {
    jsonResponse({
      retcode: 0,
      data: { tracking: [{ remark: "รับพัสดุ", areaName: "กรุงเทพ", opTime: "2026-11-06T09:00:00Z" }] },
    });
    const out = await flashExpressAdapter.fetch({ trackingNumber: "1234567890123" });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.events[0]!.status).toBe("picked_up");
    }
  });
});

describe("SPX adapter", () => {
  test("internal-portal error (retcode 2) → UNSUPPORTED", async () => {
    jsonResponse({
      retcode: 2,
      message: "retcode:-2023002, message:…GetLogisticOrderIndexMap:ref record not unique…",
      detail: "Oops, an unexpected error has occurred",
      debug: "",
    });
    const out = await spxExpressAdapter.fetch({ trackingNumber: "9980189359167" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe("UNSUPPORTED");
  });

  test("a success shape (retcode 0) parses events", async () => {
    jsonResponse({
      retcode: 0,
      data: { tracking: [{ description: "Delivered", location: "Bangkok", timestamp: "2026-11-08T10:00:00Z" }] },
    });
    const out = await spxExpressAdapter.fetch({ trackingNumber: "9980189359167" });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.currentStatus).toBe("delivered");
  });
});

describe("TNT adapter", () => {
  test("notFound shape → NOT_FOUND", async () => {
    jsonResponse({ "tracker.output": { notFound: [{ input: "856719638", hints: { invalidInput: false, carrier: null } }] } });
    const out = await tntExpressAdapter.fetch({ trackingNumber: "856719638" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe("NOT_FOUND");
  });

  test("a consignment with events parses the timeline", async () => {
    jsonResponse({
      "tracker.output": {
        consignments: [
          {
            conNumber: "856719638",
            conStatus: "Delivered",
            estimatedDeliveryDate: "2026-11-09",
            events: [
              { eventDesc: "Shipment collected", eventTime: "2026-11-05T08:00:00Z", location: { city: "Bangkok" } },
              { eventDesc: "Arrived at facility", eventTime: "2026-11-06T10:00:00Z", location: { city: "Hua Mak" } },
              { eventDesc: "Delivered", eventTime: "2026-11-08T14:00:00Z", location: { city: "Bangkok" } },
            ],
          },
        ],
      },
    });
    const out = await tntExpressAdapter.fetch({ trackingNumber: "856719638" });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.currentStatus).toBe("delivered");
      expect(out.events).toHaveLength(3);
      expect(out.events[0]!.status).toBe("picked_up");
      expect(out.confirmed).toBe(true);
      expect(out.estimatedDeliveryDate).not.toBeNull();
    }
  });

  test("unexpected JSON shape → MALFORMED_RESPONSE (never fake events)", async () => {
    jsonResponse({ some: { totally: "different", shape: true } });
    const out = await tntExpressAdapter.fetch({ trackingNumber: "856719638" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe("MALFORMED_RESPONSE");
  });
});
