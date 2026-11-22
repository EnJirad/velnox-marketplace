import type { IDatabaseClient } from "../../core/database/db-client.js";
import type {
  CreatePaymentData,
  CreateSettlementData,
  PaymentRecord,
  PaymentStatus,
  SellerSettlementRecord,
} from "./types.js";
import type { LedgerTransaction } from "@velnox/ledger";
import { assertBalancedTransaction } from "@velnox/ledger";

export interface IFinanceRepository {
  createPayment(data: CreatePaymentData): Promise<PaymentRecord>;
  getPaymentById(id: string): Promise<PaymentRecord | null>;
  getPaymentByIntentId(intentId: string): Promise<PaymentRecord | null>;
  updatePaymentStatus(id: string, status: PaymentStatus): Promise<PaymentRecord>;
  recordLedgerTransaction(tx: LedgerTransaction): Promise<void>;
  getAccountBalances(): Promise<Map<string, bigint>>;
  createSettlement(data: CreateSettlementData): Promise<SellerSettlementRecord>;
  getSettlementsBySeller(sellerId: string): Promise<SellerSettlementRecord[]>;
}

export class NeonFinanceRepository implements IFinanceRepository {
  constructor(private readonly db: IDatabaseClient) {}

  async createPayment(data: CreatePaymentData): Promise<PaymentRecord> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const res = await this.db.query<any>(
      `INSERT INTO payments (id, order_id, user_id, payment_method, payment_intent_id, amount, currency, status, idempotency_key, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10, $10)
       RETURNING id, order_id as "orderId", user_id as "userId", payment_method as "paymentMethod",
                 payment_intent_id as "paymentIntentId", amount as "amountSatang", currency,
                 status, idempotency_key as "idempotencyKey", metadata, created_at as "createdAt", updated_at as "updatedAt"`,
      [
        id,
        data.orderId,
        data.userId,
        data.paymentMethod,
        data.paymentIntentId || null,
        data.amountSatang,
        data.currency || "THB",
        data.idempotencyKey || null,
        JSON.stringify(data.metadata || {}),
        now,
      ],
    );

    return res.rows[0];
  }

  async getPaymentById(id: string): Promise<PaymentRecord | null> {
    const res = await this.db.query<any>(
      `SELECT id, order_id as "orderId", user_id as "userId", payment_method as "paymentMethod",
              payment_intent_id as "paymentIntentId", amount as "amountSatang", currency,
              status, idempotency_key as "idempotencyKey", metadata, created_at as "createdAt", updated_at as "updatedAt"
       FROM payments WHERE id = $1`,
      [id],
    );
    return res.rows[0] || null;
  }

  async getPaymentByIntentId(intentId: string): Promise<PaymentRecord | null> {
    const res = await this.db.query<any>(
      `SELECT id, order_id as "orderId", user_id as "userId", payment_method as "paymentMethod",
              payment_intent_id as "paymentIntentId", amount as "amountSatang", currency,
              status, idempotency_key as "idempotencyKey", metadata, created_at as "createdAt", updated_at as "updatedAt"
       FROM payments WHERE payment_intent_id = $1`,
      [intentId],
    );
    return res.rows[0] || null;
  }

  async updatePaymentStatus(id: string, status: PaymentStatus): Promise<PaymentRecord> {
    const res = await this.db.query<any>(
      `UPDATE payments SET status = $1, updated_at = NOW() WHERE id = $2
       RETURNING id, order_id as "orderId", user_id as "userId", payment_method as "paymentMethod",
                 payment_intent_id as "paymentIntentId", amount as "amountSatang", currency,
                 status, idempotency_key as "idempotencyKey", metadata, created_at as "createdAt", updated_at as "updatedAt"`,
      [status, id],
    );
    if (res.rows.length === 0) throw new Error("Payment not found");
    return res.rows[0];
  }

  async recordLedgerTransaction(tx: LedgerTransaction): Promise<void> {
    assertBalancedTransaction(tx);

    await this.db.transaction(async (client: IDatabaseClient) => {
      // Check idempotency
      const existing = await client.query<any>(
        `SELECT id FROM ledger_transactions WHERE idempotency_key = $1`,
        [tx.idempotencyKey],
      );
      if (existing.rows.length > 0) return; // Idempotent no-op

      const txId = crypto.randomUUID();
      const txNumber = `TX-${Date.now()}-${txId.slice(0, 6).toUpperCase()}`;

      await client.query(
        `INSERT INTO ledger_transactions (id, transaction_number, idempotency_key, description, reference_id, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [txId, txNumber, tx.idempotencyKey, tx.correlationId || "Ledger Entry", tx.postings[0]?.paymentId || null],
      );

      for (const posting of tx.postings) {
        const entryId = crypto.randomUUID();
        await client.query(
          `INSERT INTO ledger_entries (id, transaction_id, account_code, direction, amount, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [entryId, txId, posting.account, posting.direction, Number(posting.amountMinor)],
        );

        // Update account balance: debits increase assets/expenses; credits increase liabilities/equity/revenue
        const balanceDelta =
          posting.direction === "debit"
            ? ["platform_cash", "refund_clearing"].includes(posting.account)
              ? Number(posting.amountMinor)
              : -Number(posting.amountMinor)
            : ["seller_payable", "platform_revenue"].includes(posting.account)
              ? Number(posting.amountMinor)
              : -Number(posting.amountMinor);

        await client.query(
          `UPDATE ledger_accounts SET balance = balance + $1, updated_at = NOW() WHERE account_code = $2`,
          [balanceDelta, posting.account],
        );
      }
    });
  }

  async getAccountBalances(): Promise<Map<string, bigint>> {
    const res = await this.db.query<any>(`SELECT account_code as "code", balance FROM ledger_accounts`);
    const map = new Map<string, bigint>();
    for (const r of res.rows) {
      map.set(r.code, BigInt(r.balance));
    }
    return map;
  }

  async createSettlement(data: CreateSettlementData): Promise<SellerSettlementRecord> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const res = await this.db.query<any>(
      `INSERT INTO seller_settlements (id, seller_id, shop_id, order_id, gross_amount, platform_fee, net_amount, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $8)
       RETURNING id, seller_id as "sellerId", shop_id as "shopId", order_id as "orderId",
                 gross_amount as "grossSatang", platform_fee as "platformFeeSatang",
                 net_amount as "netSatang", status, settled_at as "settledAt",
                 created_at as "createdAt", updated_at as "updatedAt"`,
      [id, data.sellerId, data.shopId, data.orderId, data.grossSatang, data.platformFeeSatang, data.netSatang, now],
    );
    return res.rows[0];
  }

  async getSettlementsBySeller(sellerId: string): Promise<SellerSettlementRecord[]> {
    const res = await this.db.query<any>(
      `SELECT id, seller_id as "sellerId", shop_id as "shopId", order_id as "orderId",
              gross_amount as "grossSatang", platform_fee as "platformFeeSatang",
              net_amount as "netSatang", status, settled_at as "settledAt",
              created_at as "createdAt", updated_at as "updatedAt"
       FROM seller_settlements WHERE seller_id = $1 ORDER BY created_at DESC`,
      [sellerId],
    );
    return res.rows;
  }
}

export class MockFinanceRepository implements IFinanceRepository {
  private payments: Map<string, PaymentRecord> = new Map();
  private settlements: Map<string, SellerSettlementRecord> = new Map();
  private ledgerTransactions: Map<string, LedgerTransaction> = new Map();
  private accountBalances: Map<string, bigint> = new Map([
    ["platform_cash", 0n],
    ["seller_payable", 0n],
    ["platform_revenue", 0n],
    ["refund_clearing", 0n],
  ]);

  async createPayment(data: CreatePaymentData): Promise<PaymentRecord> {
    const id = `pay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    const record: PaymentRecord = {
      id,
      orderId: data.orderId,
      userId: data.userId,
      paymentMethod: data.paymentMethod,
      paymentIntentId: data.paymentIntentId || null,
      amountSatang: data.amountSatang,
      currency: data.currency || "THB",
      status: "pending",
      idempotencyKey: data.idempotencyKey || null,
      metadata: data.metadata || {},
      createdAt: now,
      updatedAt: now,
    };

    this.payments.set(id, record);
    return record;
  }

  async getPaymentById(id: string): Promise<PaymentRecord | null> {
    return this.payments.get(id) || null;
  }

  async getPaymentByIntentId(intentId: string): Promise<PaymentRecord | null> {
    return Array.from(this.payments.values()).find((p) => p.paymentIntentId === intentId) || null;
  }

  async updatePaymentStatus(id: string, status: PaymentStatus): Promise<PaymentRecord> {
    const p = this.payments.get(id);
    if (!p) throw new Error("Payment not found");
    p.status = status;
    p.updatedAt = new Date().toISOString();
    return p;
  }

  async recordLedgerTransaction(tx: LedgerTransaction): Promise<void> {
    assertBalancedTransaction(tx);
    if (this.ledgerTransactions.has(tx.idempotencyKey)) return;

    this.ledgerTransactions.set(tx.idempotencyKey, tx);

    for (const posting of tx.postings) {
      const cur = this.accountBalances.get(posting.account) || 0n;
      // Balance updates
      if (posting.direction === "debit") {
        this.accountBalances.set(posting.account, cur + posting.amountMinor);
      } else {
        this.accountBalances.set(posting.account, cur + posting.amountMinor);
      }
    }
  }

  async getAccountBalances(): Promise<Map<string, bigint>> {
    return new Map(this.accountBalances);
  }

  async createSettlement(data: CreateSettlementData): Promise<SellerSettlementRecord> {
    const id = `set-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    const rec: SellerSettlementRecord = {
      id,
      sellerId: data.sellerId,
      shopId: data.shopId,
      orderId: data.orderId,
      grossSatang: data.grossSatang,
      platformFeeSatang: data.platformFeeSatang,
      netSatang: data.netSatang,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };

    this.settlements.set(id, rec);
    return rec;
  }

  async getSettlementsBySeller(sellerId: string): Promise<SellerSettlementRecord[]> {
    return Array.from(this.settlements.values()).filter((s) => s.sellerId === sellerId);
  }
}
