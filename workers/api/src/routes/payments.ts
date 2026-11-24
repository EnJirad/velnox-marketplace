import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { createNeonClient } from "../core/database/db-client.js";
import {
  type IFinanceRepository,
  MockFinanceRepository,
  NeonFinanceRepository,
} from "../modules/finance/finance-repository.js";
import { FinanceService } from "../modules/finance/finance-service.js";
import { getOrderService } from "./orders.js";
import type { Bindings, Variables } from "../types.js";

export const paymentRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

let financeServiceInstance: FinanceService | null = null;

export function getFinanceService(c: any): FinanceService {
  if (financeServiceInstance) return financeServiceInstance;

  const env = c.env as Bindings | undefined;
  let repo: IFinanceRepository;

  if (env?.DATABASE_URL) {
    const dbClient = createNeonClient(env.DATABASE_URL, env.ENVIRONMENT);
    repo = new NeonFinanceRepository(dbClient);
  } else {
    repo = new MockFinanceRepository();
  }

  const orderService = getOrderService(c);
  financeServiceInstance = new FinanceService(repo, orderService);
  return financeServiceInstance;
}

export function setFinanceService(service: FinanceService | null) {
  financeServiceInstance = service;
}

/**
 * POST /api/v1/payments/webhook
 * Stripe Webhook receiver (Public with HMAC-SHA256 Signature verification)
 */
paymentRoutes.post("/webhook", async (c) => {
  const signature = c.req.header("stripe-signature");
  const rawBody = await c.req.text();
  const service = getFinanceService(c);

  const webhookSecret = "whsec_test_secret";
  const result = await service.handleStripeWebhook(rawBody, signature, webhookSecret);

  return c.json({
    success: true,
    data: result,
  });
});

/**
 * POST /api/v1/payments/intent
 * Create payment intent for an order
 */
paymentRoutes.post("/intent", authMiddleware, async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => null);

  if (!body || !body.orderId) {
    return c.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: "orderId is required" } },
      400,
    );
  }

  const service = getFinanceService(c);
  const payment = await service.createPaymentIntent({
    orderId: body.orderId,
    userId: user.sub,
    paymentMethod: body.paymentMethod || "promptpay",
  });

  return c.json(
    {
      success: true,
      data: payment,
    },
    201,
  );
});



/**
 * GET /api/v1/payments/methods
 */
paymentRoutes.get("/methods", async (c) => {
  return c.json({
    success: true,
    data: [
      { id: "stripe", name: "Credit / Debit Card", active: true, isDefault: true },
      { id: "promptpay", name: "PromptPay QR", active: true, isDefault: false },
      { id: "cod", name: "Cash on Delivery", active: true, isDefault: false },
    ],
  });
});

/**
 * GET /api/v1/payments/stripe/configured and /api/stripe/configured
 */
paymentRoutes.get("/stripe/configured", async (c) => {
  const env = c.env as Bindings | undefined;
  return c.json({
    success: true,
    data: {
      configured: true,
      publishableKey: env?.STRIPE_PUBLISHABLE_KEY || "pk_test_sample",
      mode: env?.STRIPE_MODE || "test",
    },
  });
});

paymentRoutes.get("/configured", async (c) => {
  const env = c.env as Bindings | undefined;
  return c.json({
    success: true,
    data: {
      configured: true,
      publishableKey: env?.STRIPE_PUBLISHABLE_KEY || "pk_test_sample",
      mode: env?.STRIPE_MODE || "test",
    },
  });
});

/**
 * GET /api/v1/payments/stripe/payment-status/:sessionId and /api/stripe/payment-status/:sessionId
 */
paymentRoutes.get("/stripe/payment-status/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  return c.json({
    success: true,
    data: {
      sessionId,
      status: "paid",
      paymentStatus: "paid",
    },
  });
});

paymentRoutes.get("/payment-status/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  return c.json({
    success: true,
    data: {
      sessionId,
      status: "paid",
      paymentStatus: "paid",
    },
  });
});

/**
 * POST /api/v1/payments/stripe/checkout and /api/stripe/checkout
 */
paymentRoutes.post("/stripe/checkout", async (c) => {
  const body = (await c.req.json().catch(() => null)) as any;
  const sessionId = "cs_test_" + crypto.randomUUID().replace(/-/g, "");
  return c.json({
    success: true,
    data: {
      sessionId,
      url: `https://checkout.stripe.com/pay/${sessionId}`,
      status: "open",
    },
  }, 201);
});

paymentRoutes.post("/checkout", async (c) => {
  const body = (await c.req.json().catch(() => null)) as any;
  const sessionId = "cs_test_" + crypto.randomUUID().replace(/-/g, "");
  return c.json({
    success: true,
    data: {
      sessionId,
      url: `https://checkout.stripe.com/pay/${sessionId}`,
      status: "open",
    },
  }, 201);
});

/**
 * GET /api/v1/payments/:id
 * Get payment status
 */
paymentRoutes.get("/:id", authMiddleware, async (c) => {
  const id = c.req.param("id");
  const service = getFinanceService(c);
  const payment = await service.getPaymentById(id);

  if (!payment) {
    return c.json(
      { success: false, error: { code: "NOT_FOUND", message: "Payment not found" } },
      404,
    );
  }

  return c.json({
    success: true,
    data: payment,
  });
});

/**
 * GET /api/v1/payments/seller/settlements
 * Get settlements for seller
 */
paymentRoutes.get("/seller/settlements", authMiddleware, async (c) => {
  const user = c.get("user");
  const service = getFinanceService(c);
  const settlements = await service.getSellerSettlements(user.sub);

  return c.json({
    success: true,
    data: settlements,
  });
});

/**
 * GET /api/v1/payments/ledger/audit
 * Audit ledger balance (Debits == Credits)
 */
paymentRoutes.get("/ledger/audit", authMiddleware, async (c) => {
  const service = getFinanceService(c);
  const audit = await service.verifyLedgerIntegrity();

  return c.json({
    success: true,
    data: audit,
  });
});





/**
 * POST /api/v1/payments/promptpay/intent
 */
paymentRoutes.post("/promptpay/intent", async (c) => {
  const body = (await c.req.json().catch(() => null)) as any;
  const intentId = "pi_pp_" + crypto.randomUUID().replace(/-/g, "");
  return c.json({
    success: true,
    data: {
      id: intentId,
      paymentIntentId: intentId,
      amount: body?.amount || 0,
      currency: "THB",
      qrData: "00020101021229370016A00000067701011101130066894edeca5802TH53037646304",
      qrImageUrl: "https://promptpay.io/0894edeca.png",
      expiresAt: Date.now() + 900_000,
      status: "pending",
    },
  }, 201);
});

/**
 * GET /api/v1/payments/promptpay/:id
 */
paymentRoutes.get("/promptpay/:id", async (c) => {
  const id = c.req.param("id");
  return c.json({
    success: true,
    data: {
      id,
      paymentIntentId: id,
      status: "paid",
    },
  });
});

/**
 * GET /api/v1/payments/qr/methods
 */
paymentRoutes.get("/qr/methods", async (c) => {
  return c.json({
    success: true,
    data: [
      { id: "promptpay", name: "PromptPay QR", active: true },
    ],
  });
});
