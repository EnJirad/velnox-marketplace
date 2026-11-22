import { z } from "zod";
import {
  currencyCodeSchema,
  idSchema,
  moneyDecimalSchema,
  paginationQuerySchema,
} from "@velnox/validation";
import { addressSchema } from "@velnox/validation";
import { createSuccessEnvelope } from "../common/envelope.js";

export const orderStatusSchema = z.enum([
  "pending_payment",
  "paid",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
]);

export const paymentStatusSchema = z.enum([
  "unpaid",
  "paid",
  "refunded",
  "failed",
]);

export const orderItemSchema = z.object({
  id: idSchema,
  productId: idSchema,
  variantId: idSchema.nullable().optional(),
  productName: z.string(),
  variantName: z.string().nullable().optional(),
  unitPrice: moneyDecimalSchema,
  quantity: z.number().int().positive(),
  subtotal: moneyDecimalSchema,
  imageUrl: z.string().url().nullable().optional(),
});

export const orderSummarySchema = z.object({
  id: idSchema,
  orderNumber: z.string(),
  shopId: idSchema,
  shopName: z.string(),
  status: orderStatusSchema,
  totalAmount: moneyDecimalSchema,
  shippingFee: moneyDecimalSchema.default(0),
  discountAmount: moneyDecimalSchema.default(0),
  currency: currencyCodeSchema.default("THB"),
  itemCount: z.number().int().nonnegative(),
  paymentMethod: z.string(),
  paymentStatus: paymentStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const orderDetailSchema = orderSummarySchema.extend({
  shippingAddress: addressSchema,
  notes: z.string().nullable().optional(),
  items: z.array(orderItemSchema),
  paidAt: z.string().nullable().optional(),
  shippedAt: z.string().nullable().optional(),
  deliveredAt: z.string().nullable().optional(),
  cancelledAt: z.string().nullable().optional(),
  cancellationReason: z.string().nullable().optional(),
});

export const checkoutInputSchema = z.object({
  shippingAddress: addressSchema,
  paymentMethod: z.enum(["stripe", "promptpay", "cod", "bank_transfer"]).default("promptpay"),
  notes: z.string().max(500).optional(),
});

export const orderListQuerySchema = paginationQuerySchema.extend({
  status: orderStatusSchema.optional(),
  shopId: idSchema.optional(),
});

export const orderListResponseSchema = createSuccessEnvelope(z.array(orderSummarySchema));
export const orderDetailResponseSchema = createSuccessEnvelope(orderDetailSchema);
export const checkoutResponseSchema = createSuccessEnvelope(
  z.object({
    orders: z.array(orderDetailSchema),
    totalSatang: z.number().int().nonnegative(),
  }),
);

export type OrderStatus = z.infer<typeof orderStatusSchema>;
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;
export type OrderItem = z.infer<typeof orderItemSchema>;
export type OrderSummary = z.infer<typeof orderSummarySchema>;
export type OrderDetail = z.infer<typeof orderDetailSchema>;
export type CheckoutInput = z.infer<typeof checkoutInputSchema>;
export type OrderListQuery = z.input<typeof orderListQuerySchema>;
