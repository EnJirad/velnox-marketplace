export type PaymentStatus = "pending" | "processing" | "succeeded" | "failed" | "refunded";
export type PaymentMethod = "stripe" | "promptpay" | "cod" | "bank_transfer";
export type SettlementStatus = "pending" | "available" | "paid_out" | "cancelled";

export interface PaymentRecord {
  id: string;
  orderId: string;
  userId: string;
  paymentMethod: PaymentMethod;
  paymentIntentId?: string | null;
  amountSatang: bigint | number;
  currency: string;
  status: PaymentStatus;
  idempotencyKey?: string | null;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface SellerSettlementRecord {
  id: string;
  sellerId: string;
  shopId: string;
  orderId: string;
  grossSatang: bigint | number;
  platformFeeSatang: bigint | number;
  netSatang: bigint | number;
  status: SettlementStatus;
  settledAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePaymentData {
  orderId: string;
  userId: string;
  paymentMethod: PaymentMethod;
  paymentIntentId?: string;
  amountSatang: number;
  currency?: string;
  idempotencyKey?: string;
  metadata?: Record<string, any>;
}

export interface CreateSettlementData {
  sellerId: string;
  shopId: string;
  orderId: string;
  grossSatang: number;
  platformFeeSatang: number;
  netSatang: number;
}
