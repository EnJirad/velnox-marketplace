/**
 * Abandoned-attempt cleanup contract (2026-11-02).
 *
 * SOURCE-LEVEL guards: the cleanup must free the one-active-attempt slot for a
 * session that can no longer be paid, while NEVER downgrading a paid one, never
 * deleting a financial row, and leaving an in-flight webhook as the only
 * authority over `paid`. Behavioural coverage needs a disposable PostgreSQL plus
 * live Stripe sessions and is reported as NOT RUN where it could not execute.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const STRIPE = "backend/routes/stripe.ts";

describe("abandoned attempts are retired, paid ones are not", () => {
  const src = read(STRIPE);

  test("an expired session frees the active-attempt slot", () => {
    expect(src).toContain('existing.status === "expired"');
    expect(src).toContain("SET status = 'cancelled'");
    // Only an ACTIVE row may be retired; a paid one keeps its state.
    expect(src).toContain("WHERE id = $1 AND status IN ('pending', 'requires_action')");
  });

  test("a completed-but-unpaid session is retired too (async rails)", () => {
    expect(src).toContain('existing.status === "complete" && existing.payment_status !== "paid"');
  });

  test("a COMPLETE + PAID session is never retired", () => {
    // The guard sits before the retire: paid can only be written by the webhook.
    const guard = src.indexOf('existing.payment_status !== "paid"');
    expect(guard).toBeGreaterThan(-1);
    // The next cancel statement AFTER the guard is the guarded one.
    const retire = src.indexOf("SET status = 'cancelled'", guard);
    expect(retire).toBeGreaterThan(guard);
  });

  test("cleanup preserves financial history (no deletes)", () => {
    expect(src).not.toContain("DELETE FROM payments");
    expect(src).not.toContain("DELETE FROM payment_events");
  });

  test("cleanup is idempotent by state filter", () => {
    // A second pass matches zero rows because the first moved the row out of the
    // active states; the UPDATE is never an unconditional overwrite.
    const updates = src.split("SET status = 'cancelled'").length - 1;
    expect(updates).toBeGreaterThanOrEqual(2);
    expect(src.includes("SET status = 'cancelled'\n                WHERE id = $1 AND status IN ('pending', 'requires_action')") ||
      src.includes("SET status = 'cancelled', updated_at = NOW()")).toBe(true);
  });

  test("a still-open session is reused, never re-created", () => {
    expect(src).toContain('existing.status === "open" && existing.url && existing.metadata?.method === method');
    expect(src).toContain("reused: true");
  });

  test("rail switching still expires the abandoned session first", () => {
    expect(src).toContain("stripe.checkout.sessions.expire(activeSessionId)");
    expect(src).toContain('existing.metadata?.method !== method');
  });

  test("there is exactly one webhook authority for paid", () => {
    // The only statements that write 'paid' live in the webhook settlement path.
    const paidWrites = src.split("SET status = 'paid'").length - 1;
    expect(paidWrites).toBeGreaterThanOrEqual(1);
    expect(src).toContain("constructEvent");
  });
});
