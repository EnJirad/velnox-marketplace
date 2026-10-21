/**
 * Money conversion at the Stripe boundary — no database, no network.
 *
 * These two functions are the only place an exact `NUMERIC(12,2)` amount becomes
 * an integer or is compared with Stripe's `amount_total`. A factor-of-100 bug
 * here is a 100× charge, and the checkout tests would still pass because they
 * never reach Stripe — which is exactly why this file exists. (It was written
 * after a real 100× scaling defect was caught while building the webhook
 * settlement path.)
 */
import { describe, expect, test } from "bun:test";
import { toStripeMinor } from "../payments.js";
import { amountMatches } from "../settlement.js";

describe("toStripeMinor", () => {
  test("converts a 2-decimal amount to minor units exactly once", () => {
    expect(toStripeMinor("100.00")).toBe(10000);
    expect(toStripeMinor("0.01")).toBe(1);
    expect(toStripeMinor("0.10")).toBe(10);
    expect(toStripeMinor("1234.56")).toBe(123456);
    // 99,999,999 minor units is Stripe's ceiling (999,999.99).
    expect(toStripeMinor("999999.99")).toBe(99999999);
  });

  test("refuses a zero or oversized charge", () => {
    expect(() => toStripeMinor("0.00")).toThrow();
    expect(() => toStripeMinor("1000000.00")).toThrow();
  });
});

describe("amountMatches", () => {
  test("accepts only when payment, order and Stripe agree", () => {
    expect(amountMatches("100.00", "100.00", "THB", 10000, "thb")).toBe(true);
    expect(amountMatches("0.01", "0.01", "THB", 1, "thb")).toBe(true);

    // one minor unit off
    expect(amountMatches("100.00", "100.00", "THB", 9999, "thb")).toBe(false);
    // a 100× amount (the defect this test pins)
    expect(amountMatches("100.00", "100.00", "THB", 1000000, "thb")).toBe(false);
    // payment row and order disagree
    expect(amountMatches("100.00", "99.99", "THB", 10000, "thb")).toBe(false);
    // currency mismatch, including case-normalisation on the order side
    expect(amountMatches("100.00", "100.00", "THB", 10000, "usd")).toBe(false);
    expect(amountMatches("100.00", "100.00", "thb", 10000, "THB")).toBe(true);
    // Stripe did not report an amount at all
    expect(amountMatches("100.00", "100.00", "THB", null, "thb")).toBe(false);
    expect(amountMatches("100.00", "100.00", "THB", 10000.5, "thb")).toBe(false);
  });
});
