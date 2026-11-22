import { z } from "zod";
import { currencyCodeSchema, idSchema, moneyDecimalSchema } from "@velnox/validation";
import { createSuccessEnvelope } from "../common/envelope.js";

export const addToCartInputSchema = z.object({
  productId: idSchema,
  variantId: idSchema.optional(),
  quantity: z.number().int().positive().max(999),
});

export const updateCartItemInputSchema = z.object({
  quantity: z.number().int().positive().max(999),
});

export const cartItemSchema = z.object({
  id: idSchema,
  productId: idSchema,
  variantId: idSchema.nullable().optional(),
  productName: z.string(),
  variantName: z.string().nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  unitPrice: moneyDecimalSchema,
  quantity: z.number().int().positive(),
  subtotal: moneyDecimalSchema,
  shopId: idSchema,
  shopName: z.string(),
  stockAvailable: z.number().int().nonnegative(),
});

export const cartShopGroupSchema = z.object({
  shopId: idSchema,
  shopName: z.string(),
  items: z.array(cartItemSchema),
  shopSubtotal: moneyDecimalSchema,
});

export const cartSchema = z.object({
  id: idSchema,
  shopGroups: z.array(cartShopGroupSchema),
  totalAmount: moneyDecimalSchema,
  currency: currencyCodeSchema.default("THB"),
  itemCount: z.number().int().nonnegative(),
  shopCount: z.number().int().nonnegative(),
});

export const cartResponseSchema = createSuccessEnvelope(cartSchema);

export type AddToCartInput = z.infer<typeof addToCartInputSchema>;
export type UpdateCartItemInput = z.infer<typeof updateCartItemInputSchema>;
export type CartItem = z.infer<typeof cartItemSchema>;
export type CartShopGroup = z.infer<typeof cartShopGroupSchema>;
export type Cart = z.infer<typeof cartSchema>;
