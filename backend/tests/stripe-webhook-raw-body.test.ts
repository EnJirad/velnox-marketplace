/**
 * Raw-body guarantee for `POST /api/payments/stripe/webhook`.
 *
 * Root cause this protects (2026-09-27): production answered 400 with Stripe's
 * "No signatures found matching the expected signature for payload" — a message
 * that reads like a *forged event*. The same message is produced by a *wiring*
 * bug: if the body is JSON-parsed before signature verification, the SDK hashes
 * a re-serialised object instead of the bytes Stripe signed, and EVERY genuine
 * delivery fails while the endpoint still looks like it is enforcing signatures.
 *
 * The guarantee used to live in an inline middleware inside `server.ts` holding
 * its own copy of the path test, and these tests mirrored that copy — so a
 * regression in `server.ts` could break production without failing a test. The
 * middleware is now an exported module (`middleware/stripe-raw-body.ts`) and the
 * cases below run against the real thing, plus a source-level guard that the
 * deployment's ordering cannot drift away from it.
 *
 * No database and no network: every case is local, so it runs in any workspace.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express, { type Request, type Response } from "express";
import {
  STRIPE_WEBHOOK_PATH,
  isStripeWebhookRequest,
  stripeWebhookRawBody,
} from "../middleware/stripe-raw-body.js";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const serverSrc = read("../server.ts");
const stripeSrc = read("../routes/stripe.ts");

/** The webhook route block only — its registration up to the next route. */
function webhookBlock(src: string): string {
  const start = src.indexOf('app.post("/api/payments/stripe/webhook"');
  const end = src.indexOf('app.post("/api/admin/orders/:orderId/refund"', start);
  return start === -1 || end === -1 ? "" : src.slice(start, end);
}

/**
 * A payload with multi-byte UTF-8 characters (a Thai customer name), so a body
 * that was decoded, re-encoded, re-serialised or truncated cannot pass by luck.
 */
const PAYLOAD = JSON.stringify({
  id: "evt_raw_body_probe",
  object: "event",
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_test_rawbody",
      payment_status: "paid",
      customer_details: { name: "สมชาย ใจดี", address: "กรุงเทพมหานคร" },
    },
  },
});
const PAYLOAD_BYTES = Buffer.byteLength(PAYLOAD, "utf8");

/** Reports exactly what the handler would receive. */
function reportBody(req: Request, res: Response): void {
  const body: unknown = req.body;
  res.json({
    raw: Buffer.isBuffer(body),
    bodyKind: Buffer.isBuffer(body) ? "buffer" : typeof body,
    bytes: Buffer.isBuffer(body) ? body.length : null,
    text: Buffer.isBuffer(body) ? body.toString("utf8") : null,
  });
}

/** The real deployment shape: raw body for the webhook route, JSON after it. */
function buildApp(): express.Express {
  const app = express();
  app.use(stripeWebhookRawBody);
  app.use(express.json({ limit: "1mb" }));
  app.post(STRIPE_WEBHOOK_PATH, reportBody);
  app.get(STRIPE_WEBHOOK_PATH, reportBody);
  app.post("/api/other", reportBody);
  return app;
}

/** The regression this guards: a JSON parser reaching the webhook body first. */
function buildJsonOnlyApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.post(STRIPE_WEBHOOK_PATH, reportBody);
  return app;
}

async function withApp<T>(app: express.Express, fn: (base: string) => Promise<T>): Promise<T> {
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

type Probe = { raw: boolean; bodyKind: string; bytes: number | null; text: string | null };

const post = async (url: string, contentType: string): Promise<Probe> => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: PAYLOAD,
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Probe;
};

// ═══════════════════════════════════════════════════════════════════════════
// 1. The matcher follows Express's own route matching
// ═══════════════════════════════════════════════════════════════════════════

describe("isStripeWebhookRequest", () => {
  test("accepts the configured path for POST, in any casing", () => {
    expect(isStripeWebhookRequest("POST", STRIPE_WEBHOOK_PATH)).toBe(true);
    expect(isStripeWebhookRequest("post", STRIPE_WEBHOOK_PATH)).toBe(true);
    // Express's default routing is case-insensitive, so the route IS reachable
    // here — the raw body must be read wherever the route can be reached.
    expect(isStripeWebhookRequest("POST", "/API/Payments/Stripe/Webhook")).toBe(true);
  });

  test("accepts a trailing slash, which Express also routes to the same handler", () => {
    expect(isStripeWebhookRequest("POST", `${STRIPE_WEBHOOK_PATH}/`)).toBe(true);
    expect(isStripeWebhookRequest("POST", `${STRIPE_WEBHOOK_PATH}///`)).toBe(true);
  });

  test("never buffers a safe method or another path", () => {
    expect(isStripeWebhookRequest("GET", STRIPE_WEBHOOK_PATH)).toBe(false);
    expect(isStripeWebhookRequest("OPTIONS", STRIPE_WEBHOOK_PATH)).toBe(false);
    expect(isStripeWebhookRequest("PATCH", STRIPE_WEBHOOK_PATH)).toBe(false);
    // Near misses must not be treated as the webhook route.
    expect(isStripeWebhookRequest("POST", `${STRIPE_WEBHOOK_PATH}s`)).toBe(false);
    expect(isStripeWebhookRequest("POST", `${STRIPE_WEBHOOK_PATH}/extra`)).toBe(false);
    expect(isStripeWebhookRequest("POST", `/api/admin${STRIPE_WEBHOOK_PATH}`)).toBe(false);
    expect(isStripeWebhookRequest("POST", "/")).toBe(false);
    expect(isStripeWebhookRequest("POST", "")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. The handler receives the exact signed bytes
// ═══════════════════════════════════════════════════════════════════════════

describe("the webhook body reaches the handler as the bytes Stripe signed", () => {
  test("an application/json delivery is a Buffer, byte-for-byte, with no re-serialisation", async () => {
    await withApp(buildApp(), async (base) => {
      const probe = await post(`${base}${STRIPE_WEBHOOK_PATH}`, "application/json");
      expect(probe.raw).toBe(true);
      expect(probe.bytes).toBe(PAYLOAD_BYTES);
      // Equal to the raw request text, NOT to a re-encoded JSON.stringify output:
      // multi-byte characters would survive a re-encode but a re-ordered or
      // re-spaced body would not, and Stripe's HMAC covers every byte.
      expect(probe.text).toBe(PAYLOAD);
    });
  });

  test("a trailing-slash delivery is buffered too (the route is reachable there)", async () => {
    await withApp(buildApp(), async (base) => {
      const probe = await post(`${base}${STRIPE_WEBHOOK_PATH}/`, "application/json");
      expect(probe.raw).toBe(true);
      expect(probe.text).toBe(PAYLOAD);
    });
  });

  test("a non-JSON Content-Type does not make the raw bytes vanish", async () => {
    // The declared content type is not part of the signed payload, so it must not
    // decide whether this route buffers. Stripe today sends application/json, but
    // selecting a parser by header means one changed hop silently verifies the
    // wrong thing.
    await withApp(buildApp(), async (base) => {
      const probe = await post(`${base}${STRIPE_WEBHOOK_PATH}`, "application/octet-stream");
      expect(probe.raw).toBe(true);
      expect(probe.text).toBe(PAYLOAD);
    });
  });

  test("every other route still gets parsed JSON, and a GET is never buffered", async () => {
    await withApp(buildApp(), async (base) => {
      const other = await post(`${base}/api/other`, "application/json");
      expect(other.raw).toBe(false);
      expect(other.bodyKind).toBe("object");

      const get = await fetch(`${base}${STRIPE_WEBHOOK_PATH}`);
      const probe = (await get.json()) as Probe;
      expect(probe.raw).toBe(false);
    });
  });

  test("without the middleware the same delivery arrives as an object — the regression, made visible", async () => {
    // This is the exact shape of the production symptom: verification would hash
    // "[object Object]" and report a forged-event error for a genuine delivery.
    await withApp(buildJsonOnlyApp(), async (base) => {
      const probe = await post(`${base}${STRIPE_WEBHOOK_PATH}`, "application/json");
      expect(probe.raw).toBe(false);
      expect(probe.bodyKind).toBe("object");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. The deployment's wiring cannot drift away from the guarantee
// ═══════════════════════════════════════════════════════════════════════════

describe("server.ts mounts the real middleware before the JSON parser", () => {
  test("the exported middleware is what is mounted — not a second inline copy", () => {
    expect(serverSrc).toContain("import { stripeWebhookRawBody } from \"./middleware/stripe-raw-body.js\"");
    expect(serverSrc).toContain("app.use(stripeWebhookRawBody)");
    // The inline copy is gone: two copies of the path test is how this drifted.
    expect(serverSrc).not.toContain('req.path === "/api/payments/stripe/webhook"');
  });

  test("it is mounted BEFORE express.json(), which is what makes verification possible", () => {
    const rawAt = serverSrc.indexOf("app.use(stripeWebhookRawBody)");
    const jsonAt = serverSrc.indexOf("app.use(express.json(");
    expect(rawAt).toBeGreaterThan(-1);
    expect(jsonAt).toBeGreaterThan(-1);
    expect(rawAt).toBeLessThan(jsonAt);
  });
});

describe("the webhook handler names the stage instead of blaming the signature", () => {
  const webhook = webhookBlock(stripeSrc);

  test("the route is registered at the path the middleware matches", () => {
    expect(webhook).toContain(`app.post("${STRIPE_WEBHOOK_PATH}"`);
  });

  test("a body that is not raw is refused distinctly, before any signature check", () => {
    const guardAt = webhook.indexOf("Webhook body was not preserved for signature verification");
    const verifyAt = webhook.indexOf("constructEventAsync");
    expect(guardAt).toBeGreaterThan(-1);
    expect(verifyAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(verifyAt);
    expect(webhook).toContain("Buffer.isBuffer(rawBody)");
  });

  test("the request is logged by stage, without ever logging the payload", () => {
    expect(webhook).toContain("webhook_received");
    expect(webhook).toContain("signature_verification_failed");
    expect(webhook).toContain("body=${Buffer.isBuffer(rawBody)");
  });
});
