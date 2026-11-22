import type { DbQueryable } from "../../../../database/src/types.ts";
import {
  calculatePlatformFeeMinor,
  calculateSellerPayableMinor,
  verifyStripeSignature,
  type CreatePaymentInput,
  type PaymentAttempt,
  type PaymentMethodId,
  type WebhookEvent,
} from "../domain/payment.ts";
import { PaymentRepository, type LockedOrderRow } from "../repository/payment-repository.ts";
import { InventoryRepository } from "../../inventory/repository/inventory-repository.ts";
import {
  LedgerService,
  createCustomerPaymentTransaction,
  createSellerSettlementTransaction,
  createRefundTransaction,
} from "../../ledger/domain/ledger.ts";
import { LedgerDomainService } from "../../ledger/services/ledger-domain-service.ts";
import {
  AppError,
  NotFoundError,
  ValidationError,
  ConflictError,
  ForbiddenError,
} from "../../../core/errors/app-error.ts";

export interface WebhookProcessResult {
  readonly received: boolean;
  readonly duplicate?: boolean;
  readonly eventId: string;
  readonly eventType: string;
  readonly settledOrdersCount?: number;
}

export interface SellerSettlementResult {
  readonly settlementId: string;
  readonly sellerId: string;
  readonly amountMinor: bigint;
  readonly status: string;
  readonly ledgerEntries: readonly any[];
}

export class PaymentService {
  /**
   * Discovers available payment methods based on platform configuration.
   */
  public static getAvailablePaymentMethods(): {
    methods: Array<{ id: PaymentMethodId; name: string; description: string; enabled: boolean }>;
  } {
    const codEnabled = process.env.COD_ENABLED === "true" || process.env.COD_ENABLED === "1";

    return {
      methods: [
        {
          id: "CARD",
          name: "Credit / Debit Card",
          description: "Pay securely with Visa, Mastercard, JCB, or UnionPay via Stripe",
          enabled: true,
        },
        {
          id: "PROMPTPAY",
          name: "PromptPay QR",
          description: "Scan QR code with any Thai Mobile Banking app",
          enabled: true,
        },
        {
          id: "COD",
          name: "Cash on Delivery",
          description: "Pay with cash upon package delivery",
          enabled: codEnabled,
        },
      ],
    };
  }

  /**
   * Creates a payment attempt for a single order or checkout group.
   * Enforces 30-minute reservation deadline check before creating any session.
   */
  public static async createPaymentAttempt(
    db: DbQueryable,
    input: CreatePaymentInput,
    userId: string,
  ): Promise<PaymentAttempt> {
    if (!input.orderId && !input.checkoutGroupId) {
      throw new ValidationError("Either orderId or checkoutGroupId must be provided");
    }

    if (input.method === "COD") {
      const codEnabled = process.env.COD_ENABLED === "true" || process.env.COD_ENABLED === "1";
      if (!codEnabled) {
        throw new ForbiddenError("Cash on Delivery is currently disabled", "PAYMENT_METHOD_DISABLED");
      }
    }

    let orders: LockedOrderRow[] = [];
    if (input.orderId) {
      orders = await PaymentRepository.lockOrders(db, [input.orderId]);
    } else if (input.checkoutGroupId) {
      orders = await PaymentRepository.lockOrdersForCheckoutGroup(db, input.checkoutGroupId);
    }

    if (orders.length === 0) {
      throw new NotFoundError("Order or checkout group not found");
    }

    // Verify all orders are payable and reservation window has not expired
    for (const order of orders) {
      if (order.status !== "pending" && order.status !== "pending_payment") {
        throw new ConflictError(
          `Order '${order.id}' is not payable (current status: '${order.status}')`,
          "ORDER_NOT_PAYABLE",
        );
      }
      if (order.inventory_released) {
        throw new ConflictError(
          `Order '${order.id}' reservation has expired and inventory was released`,
          "PAYMENT_RESERVATION_EXPIRED",
        );
      }
    }

    // Calculate total amount from orders
    let totalMinor = 0n;
    for (const order of orders) {
      totalMinor += BigInt(Math.round(parseFloat(order.total_amount) * 100));
    }
    const totalAmountThb = (Number(totalMinor) / 100).toFixed(2);

    const provider = input.method === "COD" ? "cod" : "stripe";
    const payment = await PaymentRepository.createPayment(db, {
      orderId: input.orderId,
      checkoutGroupId: input.checkoutGroupId,
      amount: totalAmountThb,
      currency: input.currency ?? "THB",
      method: input.method,
      provider,
      status: "requires_action",
      providerCheckoutSessionId: `cs_mock_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    });

    return payment;
  }

  /**
   * Authoritative Stripe Webhook Handler.
   *
   * Invariants:
   * 1. Raw body HMAC-SHA256 signature verification.
   * 2. Atomic event claim in `payment_events` with replay deduplication.
   * 3. Deterministic order locking (`id ASC`) to eliminate deadlocks.
   * 4. Stock commit on payment success; stock release on expiration/failure.
   * 5. Double-entry ledger postings with exact satang calculation ($\sum\text{Debits} == \sum\text{Credits}$).
   */
  public static async handleStripeWebhook(
    db: DbQueryable,
    rawBody: string | Buffer,
    signatureHeader: string,
    webhookSecret: string,
    skipSignatureVerification = false,
  ): Promise<WebhookProcessResult> {
    if (!skipSignatureVerification) {
      const isValid = verifyStripeSignature(rawBody, signatureHeader, webhookSecret);
      if (!isValid) {
        throw new ValidationError("Invalid Stripe webhook signature");
      }
    }

    const payloadString = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody;
    let event: WebhookEvent;
    try {
      event = JSON.parse(payloadString);
    } catch {
      throw new ValidationError("Invalid JSON payload in webhook body");
    }

    const claim = await PaymentRepository.claimPaymentEvent(
      db,
      "stripe",
      event.id,
      event.type,
      event.data?.object,
    );

    if (claim.isDuplicate) {
      return {
        received: true,
        duplicate: true,
        eventId: event.id,
        eventType: event.type,
      };
    }

    try {
      let settledCount = 0;
      const obj = event.data?.object ?? {};

      switch (event.type) {
        case "checkout.session.completed":
        case "payment_intent.succeeded": {
          settledCount = await this.settlePaymentSuccess(db, event, obj);
          break;
        }

        case "checkout.session.expired":
        case "payment_intent.payment_failed":
        case "payment_intent.canceled": {
          await this.terminatePaymentFailure(db, event, obj);
          break;
        }

        case "charge.refunded":
        case "refund.updated": {
          await this.processRefundEvent(db, event, obj);
          break;
        }

        default:
          // Unhandled events recorded for audit
          break;
      }

      await PaymentRepository.updatePaymentEventStatus(db, event.id, "processed");
      return {
        received: true,
        duplicate: false,
        eventId: event.id,
        eventType: event.type,
        settledOrdersCount: settledCount,
      };
    } catch (err: any) {
      await PaymentRepository.updatePaymentEventStatus(
        db,
        event.id,
        "failed",
        err instanceof Error ? err.message : String(err),
      );
      throw err;
    }
  }

  /**
   * Settles payment success atomically:
   * - Marks orders `paid`
   * - Marks payment `paid`
   * - Commits inventory hold to permanent sale
   * - Posts balanced double-entry transactions to ledger
   * - Records seller commission records
   */
  private static async settlePaymentSuccess(
    db: DbQueryable,
    event: WebhookEvent,
    obj: any,
  ): Promise<number> {
    const sessionId = obj.id;
    const paymentIntentId = typeof obj.payment_intent === "string" ? obj.payment_intent : obj.id;
    const orderIdHint = obj.metadata?.orderId;
    const checkoutGroupIdHint = obj.metadata?.checkoutGroupId;

    let payment =
      (await PaymentRepository.findPaymentBySessionId(db, sessionId)) ||
      (await PaymentRepository.findPaymentByProviderPaymentId(db, paymentIntentId));

    if (!payment && orderIdHint) {
      payment = await PaymentRepository.findPaymentForOrder(db, orderIdHint);
    }

    let ordersToLock: string[] = [];
    if (payment?.checkoutGroupId || checkoutGroupIdHint) {
      const gid = payment?.checkoutGroupId ?? checkoutGroupIdHint;
      const groupOrders = await PaymentRepository.lockOrdersForCheckoutGroup(db, gid);
      ordersToLock = groupOrders.map((o) => o.id);
    } else if (payment?.orderId || orderIdHint) {
      const oid = payment?.orderId ?? orderIdHint;
      ordersToLock = [oid];
      await PaymentRepository.lockOrders(db, ordersToLock);
    }

    if (ordersToLock.length === 0) {
      return 0;
    }

    // 1. Move orders to 'paid'
    const movedOrders = await PaymentRepository.markOrdersPaid(db, ordersToLock);
    if (movedOrders.length === 0) {
      // Already paid or cancelled
      return 0;
    }

    // 2. Mark payment attempt as 'paid'
    if (payment) {
      await PaymentRepository.updatePaymentStatus(
        db,
        payment.id,
        "paid",
        paymentIntentId,
      );
    }

    // 3. Commit inventory stock for all order items
    const items = await PaymentRepository.getOrderItems(db, movedOrders.map((o) => o.id));
    for (const item of items) {
      await InventoryRepository.commitStock(
        db,
        item.product_id,
        item.quantity,
        item.variant_id ?? undefined,
      );
    }

    // 4. Double-Entry Ledger Posting for each settled order
    for (const order of movedOrders) {
      const grossAmountMinor = BigInt(Math.round(parseFloat(order.total_amount) * 100));
      const platformFeeMinor = calculatePlatformFeeMinor(grossAmountMinor, 0.05);
      const sellerId =
        (await PaymentRepository.getSellerIdForShop(db, order.shop_id)) ||
        order.shop_id;

      const idempotencyKey = `ledger:payment:${payment?.id ?? event.id}:order:${order.id}`;

      const txn = createCustomerPaymentTransaction({
        idempotencyKey,
        correlationId: event.id,
        purchaseId: order.checkout_group_id ?? undefined,
        orderId: order.id,
        paymentId: payment?.id ?? event.id,
        sellerId,
        grossAmountMinor,
        platformFeeMinor,
        currency: "THB",
      });

      await LedgerService.recordTransaction(db, txn);

      // Record commission row
      await PaymentRepository.createCommissionRecord(
        db,
        order.id,
        sellerId,
        platformFeeMinor,
        0.05,
      );
    }

    return movedOrders.length;
  }

  /**
   * Handles payment cancellation or expiry:
   * - Releases reserved inventory
   * - Marks orders `payment_failed` or `cancelled`
   * - Marks payment row `failed` or `cancelled`
   */
  private static async terminatePaymentFailure(
    db: DbQueryable,
    event: WebhookEvent,
    obj: any,
  ): Promise<void> {
    const sessionId = obj.id;
    const paymentIntentId = typeof obj.payment_intent === "string" ? obj.payment_intent : obj.id;
    const orderIdHint = obj.metadata?.orderId;
    const checkoutGroupIdHint = obj.metadata?.checkoutGroupId;

    let payment =
      (await PaymentRepository.findPaymentBySessionId(db, sessionId)) ||
      (await PaymentRepository.findPaymentByProviderPaymentId(db, paymentIntentId));

    if (!payment && orderIdHint) {
      payment = await PaymentRepository.findPaymentForOrder(db, orderIdHint);
    }

    let ordersToLock: string[] = [];
    if (payment?.checkoutGroupId || checkoutGroupIdHint) {
      const gid = payment?.checkoutGroupId ?? checkoutGroupIdHint;
      const groupOrders = await PaymentRepository.lockOrdersForCheckoutGroup(db, gid);
      ordersToLock = groupOrders.map((o) => o.id);
    } else if (payment?.orderId || orderIdHint) {
      const oid = payment?.orderId ?? orderIdHint;
      ordersToLock = [oid];
      await PaymentRepository.lockOrders(db, ordersToLock);
    }

    if (ordersToLock.length === 0) return;

    const failureStatus =
      event.type === "checkout.session.expired" ? "cancelled" : "payment_failed";

    // 1. Move orders to terminal status
    const failedOrders = await PaymentRepository.markOrdersFailed(
      db,
      ordersToLock,
      failureStatus,
    );

    // 2. Update payment status
    if (payment) {
      await PaymentRepository.updatePaymentStatus(
        db,
        payment.id,
        failureStatus === "cancelled" ? "cancelled" : "failed",
        paymentIntentId,
        "PAYMENT_TERMINATED",
        `Webhook event ${event.type}`,
      );
    }

    // 3. Release reserved inventory
    const items = await PaymentRepository.getOrderItems(db, failedOrders.map((o) => o.id));
    for (const item of items) {
      await InventoryRepository.releaseStock(
        db,
        item.product_id,
        item.quantity,
        item.variant_id ?? undefined,
      );
    }
  }

  /**
   * Processes refund event:
   * - Records refund row
   * - Creates balanced double-entry refund transaction
   */
  private static async processRefundEvent(
    db: DbQueryable,
    event: WebhookEvent,
    obj: any,
  ): Promise<void> {
    const refundId = obj.id;
    const status = obj.status;
    if (status !== "succeeded") return;

    const amountMinor = BigInt(Math.round(parseFloat(obj.amount ?? "0")));
    if (amountMinor <= 0n) return;

    const paymentIntentId = obj.payment_intent;
    const payment = paymentIntentId
      ? await PaymentRepository.findPaymentByProviderPaymentId(db, paymentIntentId)
      : null;

    await PaymentRepository.recordRefund(db, {
      orderId: payment?.orderId,
      paymentId: payment?.id,
      checkoutGroupId: payment?.checkoutGroupId,
      amountSatang: amountMinor,
      status: "refunded",
      providerRefundId: refundId,
    });

    const refundTxn = createRefundTransaction({
      idempotencyKey: `ledger:refund:${refundId}`,
      correlationId: event.id,
      refundId,
      paymentId: payment?.id,
      orderId: payment?.orderId ?? undefined,
      purchaseId: payment?.checkoutGroupId ?? undefined,
      refundAmountMinor: amountMinor,
      currency: "THB",
    });

    await LedgerService.recordTransaction(db, refundTxn);
  }

  /**
   * Automated Seller Settlement:
   * Executes payout from platform cash to seller, reducing platform's seller_payable liability.
   */
  public static async executeSellerSettlement(
    db: DbQueryable,
    sellerId: string,
    amountMinor: bigint,
    correlationId?: string,
  ): Promise<SellerSettlementResult> {
    if (amountMinor <= 0n) {
      throw new ValidationError("Settlement amountMinor must be strictly greater than 0n");
    }

    // Check seller accrued balance in ledger
    const availableBalance = await LedgerDomainService.getSellerPayableBalance(db, sellerId);
    if (availableBalance < amountMinor) {
      throw new ConflictError(
        `Insufficient accrued seller payable balance. Available: ${availableBalance} Satang, Requested: ${amountMinor} Satang`,
        "INSUFFICIENT_PAYABLE_BALANCE",
      );
    }

    // 1. Create settlement record
    const settlementId = await PaymentRepository.createSettlementRecord(
      db,
      sellerId,
      amountMinor,
      "processing",
    );

    // 2. Post balanced double-entry transaction (Debit: seller_payable, Credit: platform_cash)
    const idempotencyKey = `ledger:settlement:${settlementId}`;
    const txn = createSellerSettlementTransaction({
      idempotencyKey,
      correlationId: correlationId ?? settlementId,
      settlementId,
      sellerId,
      amountMinor,
      currency: "THB",
    });

    const recordResult = await LedgerService.recordTransaction(db, txn);

    // 3. Mark settlement completed
    await PaymentRepository.updateSettlementStatus(db, settlementId, "completed");

    return {
      settlementId,
      sellerId,
      amountMinor,
      status: "completed",
      ledgerEntries: recordResult.entries,
    };
  }
}
