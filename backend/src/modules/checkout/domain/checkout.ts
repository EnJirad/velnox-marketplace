export interface CheckoutOrderItem {
  readonly id: string;
  readonly orderId: string;
  readonly productId: string;
  readonly variantId: string | null;
  readonly productTitle: string;
  readonly quantity: number;
  readonly priceMinor: bigint;
  readonly totalMinor: bigint;
}

export interface CheckoutOrder {
  readonly id: string;
  readonly checkoutGroupId: string;
  readonly shopId: string;
  readonly status: string;
  readonly totalAmountMinor: bigint;
  readonly paymentExpiresAt: Date;
  readonly items: readonly CheckoutOrderItem[];
}

export interface CheckoutGroup {
  readonly id: string;
  readonly userId: string;
  readonly idempotencyKey: string;
  readonly status: string;
  readonly totalAmountMinor: bigint;
  readonly currency: string;
  readonly createdAt: Date;
}

export interface CheckoutResult {
  readonly checkoutGroup: CheckoutGroup;
  readonly orders: readonly CheckoutOrder[];
  readonly paymentExpiresAtMs: number;
}
