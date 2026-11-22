import { z } from "zod";
import {
  currencyCodeSchema,
  idSchema,
  moneyDecimalSchema,
  paginationQuerySchema,
  slugSchema,
} from "@velnox/validation";
import { createSuccessEnvelope } from "../common/envelope.js";

export const productListQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().optional(),
  categoryId: idSchema.optional(),
  categorySlug: slugSchema.optional(),
  minPrice: moneyDecimalSchema.optional(),
  maxPrice: moneyDecimalSchema.optional(),
  sort: z.enum(["popular", "price_asc", "price_desc", "newest"]).default("popular"),
});

export const productVariantSummarySchema = z.object({
  id: idSchema,
  name: z.string(),
  sku: z.string().optional(),
  price: moneyDecimalSchema,
  stock: z.number().int().nonnegative(),
});

export const productSummarySchema = z.object({
  id: idSchema,
  shopId: idSchema,
  shopName: z.string(),
  name: z.string(),
  slug: slugSchema,
  price: moneyDecimalSchema,
  originalPrice: moneyDecimalSchema.nullable().optional(),
  currency: currencyCodeSchema.default("THB"),
  primaryImageUrl: z.string().url().nullable().optional(),
  rating: z.number().min(0).max(5).default(0),
  reviewCount: z.number().int().nonnegative().default(0),
  isAvailable: z.boolean().default(true),
});

export const productDetailSchema = productSummarySchema.extend({
  description: z.string().default(""),
  images: z.array(z.string().url()).default([]),
  variants: z.array(productVariantSummarySchema).default([]),
  categoryPath: z.array(z.object({ id: idSchema, name: z.string(), slug: slugSchema })).optional(),
});

export const productListResponseSchema = createSuccessEnvelope(z.array(productSummarySchema));
export const productDetailResponseSchema = createSuccessEnvelope(productDetailSchema);

export type ProductListQuery = z.infer<typeof productListQuerySchema>;
export type ProductSummary = z.infer<typeof productSummarySchema>;
export type ProductDetail = z.infer<typeof productDetailSchema>;
