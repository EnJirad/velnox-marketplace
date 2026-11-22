import type { AddressInput } from "@velnox/validation";
import type { OrderStatus, PaymentStatus } from "@velnox/api-contract";

export interface OrderRecord {
  id: string;
  orderNumber: string;
  userId: string;
  shopId: string;
  shopName?: string;
  status: OrderStatus;
  totalAmount: bigint | number; // satang
  shippingFee: bigint | number; // satang
  discountAmount: bigint | number; // satang
  currency: string;
  shippingAddress: AddressInput;
  paymentMethod: string;
  paymentStatus: PaymentStatus;
  notes?: string | null;
  paidAt?: string | null;
  shippedAt?: string | null;
  deliveredAt?: string | null;
  cancelledAt?: string | null;
  cancellationReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderItemRecord {
  id: string;
  orderId: string;
  productId: string;
  variantId?: string | null;
  productName: string;
  variantName?: string | null;
  unitPrice: bigint | number; // satang
  quantity: number;
  subtotal: bigint | number; // satang
  imageUrl?: string | null;
  createdAt: string;
}

export interface OrderDetailRecord extends OrderRecord {
  items: OrderItemRecord[];
}

export interface CreateOrderData {
  orderNumber: string;
  userId: string;
  shopId: string;
  totalAmountSatang: number;
  shippingFeeSatang?: number;
  discountAmountSatang?: number;
  currency?: string;
  shippingAddress: AddressInput;
  paymentMethod: string;
  notes?: string;
  items: Array<{
    productId: string;
    variantId?: string | null;
    productName: string;
    variantName?: string | null;
    unitPriceSatang: number;
    quantity: number;
    subtotalSatang: number;
    imageUrl?: string | null;
  }>;
}

export interface OrderListFilter {
  userId?: string;
  shopId?: string;
  status?: OrderStatus;
  page?: number;
  limit?: number;
}
