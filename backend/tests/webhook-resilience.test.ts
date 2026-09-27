/**
 * Webhook resilience guard — every DB wait is bounded, and the webhook answers
 * instead of exiting the process mid-request.
 *
 * Root cause this protects (2026-09-27): production
 * `POST /api/payments/stripe/webhook` accepted a correctly signed Stripe event
 * and then never answered — the Stripe CLI aborts a forwarded event after 30s
 * ("context deadline exceeded (Client.Timeout exceeded while awaiting
 * headers)"), while `GET /api/stripe/configured` and DB-backed reads like
 * `GET /api/shops` stayed fast, so the process was demonstrably alive.
 *
 * The handler's only blocking work happens AFTER the signature check and BEFORE
 * `res.json`: the `payment_events` idempotency write, the event dispatch, and
 * the payment/order state updates. `connectionTimeoutMillis` bounds only
 * ACQUIRING a connection — node-postgres applies no deadline to a statement the
 * server never finishes — so a stalled Neon statement left the request pending
 * until the caller gave up. `pool.on("error")` calling `process.exit(-1)` was
 * the second way to stop answering: a routine Neon idle-connection close
 * restarted the whole process mid-request.
 *
 * These cases are static/pure: they assert the properties (not a timing) and
 * run in any workspace, with or without a database.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pool from "../db/index.js";

/** The Stripe CLI aborts a `--forward-to` delivery after this many ms. */
const STRIPE_CLI_FORWARD_TIMEOUT_MS = 30_000;

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const dbSrc = read("../db/index.ts");
const stripeSrc = read("../routes/stripe.ts");

/** The webhook route block only — its registration up to the next route. */
function webhookBlock(src: string): string {
  const start = src.indexOf('app.post("/api/payments/stripe/webhook"');
  const end = src.indexOf('app.post("/api/admin/orders/:orderId/refund"', start);
  return start === -1 || end === -1 ? "" : src.slice(start, end);
}

/** The `pool.on("error")` registration up to the next top-level item. */
function poolErrorHandler(src: string): string {
  const start = src.indexOf('pool.on("error"');
  const end = src.indexOf("export async function query", start);
  return start === -1 ? "" : src.slice(start, end === -1 ? undefined : end);
}

/** The `new pg.Pool({...})` call only. */
function poolConfigBlock(src: string): string {
  const start = src.indexOf("new pg.Pool({");
  const end = src.indexOf('pool.on("error"', start);
  return start === -1 || end === -1 ? "" : src.slice(start, end);
}

/** Source with block and line comments removed, so a guard matches CODE only. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const webhook = webhookBlock(stripeSrc);

describe("the DB pool bounds every wait on a request path", () => {
  test("a per-query deadline is configured, so a stalled statement cannot hang the request", () => {
    const timeout = pool.options.query_timeout;
    expect(typeof timeout).toBe("number");
    expect(Number(timeout)).toBeGreaterThan(0);
  });

  test("one stalled webhook still answers inside the caller's 30s forward window", () => {
    const connect = Number(pool.options.connectionTimeoutMillis ?? 0);
    const query = Number(pool.options.query_timeout ?? 0);
    expect(connect).toBeGreaterThan(0);
    expect(connect + query).toBeLessThan(STRIPE_CLI_FORWARD_TIMEOUT_MS);
  });

  test("the pool size is unchanged (20) — the fix bounds waits, it does not shrink the pool", () => {
    expect(pool.options.max).toBe(20);
  });

  test("no server-side timeout is sent as a startup parameter (Neon's PgBouncer rejects unknown ones)", () => {
    // node-postgres sends `statement_timeout` / `lock_timeout` /
    // `idle_in_transaction_session_timeout` in the STARTUP packet. PgBouncer —
    // which fronts Neon — rejects a parameter it does not track with
    // "unsupported startup parameter", so adding one here would break EVERY
    // connection instead of hardening one route. `query_timeout` is enforced in
    // this process and is the timeout that may be used here.
    const config = poolConfigBlock(dbSrc);
    expect(config).toContain("query_timeout");
    expect(config).not.toContain("statement_timeout");
    expect(config).not.toContain("lock_timeout");
    expect(config).not.toContain("idle_in_transaction_session_timeout");
  });
});

describe("the pool no longer turns a routine idle-connection close into a restart", () => {
  test("db/index.ts never exits the process", () => {
    // Comments are stripped first: the file documents the hazard it removed, so
    // a bare text match would fail on its own explanation rather than on code.
    expect(stripComments(dbSrc)).not.toMatch(/process\.exit/);
  });

  test("the pool error handler logs safe fields and keeps the pool alive", () => {
    const handler = poolErrorHandler(dbSrc);
    expect(handler).not.toBe("");
    expect(handler).toContain("[DB] idle client error");
    expect(handler).not.toContain("process.exit");
    // Same safe shape as the failed-query logger — never the connection string,
    // credentials, cookies, or query parameters (which may carry PII).
    expect(handler).toContain("code:");
    expect(handler).toContain("message:");
    expect(handler).not.toContain("connectionString");
  });
});

describe("the webhook answers every outcome and is stage-instrumented", () => {
  test("the route block is present", () => {
    expect(webhook).toContain('"/api/payments/stripe/webhook"');
  });

  test("every outcome still writes a response — no path falls through unanswered", () => {
    for (const status of ["503", "400", "200", "500"]) {
      expect(webhook).toContain(`res.status(${status})`);
    }
  });

  test("the blocking stages are timed, so a stall is locatable in the Render log", () => {
    expect(webhook).toContain("signature verified (+");
    expect(webhook).toContain("claimed — dispatching (+");
    expect(webhook).toContain("processed ");
    expect(webhook).toContain("+${elapsed()}ms");
  });

  test("no log line can leak a secret, a token, a cookie, or the raw payload", () => {
    const logLines = webhook.split("\n").filter((line) => /console\.(log|warn|error)/.test(line));
    expect(logLines.length).toBeGreaterThanOrEqual(4);
    const forbidden = [
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "client_secret",
      "access_token",
      "cookie",
      "req.headers",
      "req.body",
      "event.data.object",
      "webhookSecret",
    ];
    for (const line of logLines) {
      for (const token of forbidden) {
        expect(line.toLowerCase()).not.toContain(token.toLowerCase());
      }
    }
  });
});
