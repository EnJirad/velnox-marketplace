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
