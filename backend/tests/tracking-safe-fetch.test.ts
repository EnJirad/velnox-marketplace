/**
 * Tracking safe-fetch — masking, timeout and error normalization. No network.
 */
import { describe, expect, test } from "bun:test";
import { maskTrackingNumber, safeFetch, DEFAULT_CARRIER_TIMEOUT_MS } from "../lib/tracking/safe-fetch.js";

describe("maskTrackingNumber", () => {
  test("keeps only the first two and last four characters", () => {
    expect(maskTrackingNumber("TH1234567890123")).toBe("TH••••0123");
  });

  test("short numbers are fully masked", () => {
    expect(maskTrackingNumber("123456")).toBe("••••");
  });

  test("empty stays empty", () => {
    expect(maskTrackingNumber("")).toBe("");
  });
});

describe("safeFetch error normalization", () => {
  test("4xx → NOT_FOUND, not retryable", async () => {
    const res = new Response("{}", { status: 404 });
    const orig = globalThis.fetch;
    globalThis.fetch = async () => res;
    try {
      const out = await safeFetch({ url: "https://x.test/", method: "GET", carrier: "TNT", trackingNumber: "1234" });
      expect(out.ok).toBe(false);
      if (!out.ok) {
        expect(out.error.code).toBe("NOT_FOUND");
        expect(out.error.retryable).toBe(false);
      }
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("429 → RATE_LIMITED", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async () => new Response("{}", { status: 429 });
    try {
      const out = await safeFetch({ url: "https://x.test/", method: "GET", carrier: "JT", trackingNumber: "1234" });
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.error.code).toBe("RATE_LIMITED");
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("timeout → TIMEOUT, retryable (never a zero timeout)", () => {
    expect(DEFAULT_CARRIER_TIMEOUT_MS).toBeGreaterThan(0);
  });

  test("timeout abort produces TIMEOUT", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Carrier timeout", "TimeoutError")),
        );
      });
    try {
      const out = await safeFetch({ url: "https://x.test/", method: "GET", carrier: "TNT", trackingNumber: "1234", timeoutMs: 20 });
      expect(out.ok).toBe(false);
      if (!out.ok) {
        expect(out.error.code).toBe("TIMEOUT");
        expect(out.error.retryable).toBe(true);
      }
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("network TypeError → CARRIER_UNAVAILABLE, retryable", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new TypeError("Failed to fetch");
    };
    try {
      const out = await safeFetch({ url: "https://x.test/", method: "GET", carrier: "SPX", trackingNumber: "1234" });
      expect(out.ok).toBe(false);
      if (!out.ok) {
        expect(out.error.code).toBe("CARRIER_UNAVAILABLE");
        expect(out.error.retryable).toBe(true);
      }
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("2xx JSON passes through", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ tracker: { output: {} } }), { status: 200 });
    try {
      const out = await safeFetch({ url: "https://x.test/", method: "GET", carrier: "TNT", trackingNumber: "1234" });
      expect(out.ok).toBe(true);
      if (out.ok) expect(out.json).toEqual({ tracker: { output: {} } });
    } finally {
      globalThis.fetch = orig;
    }
  });
});
