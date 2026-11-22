import { z } from "zod";

export const paginationMetaSchema = z.object({
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  timestamp: z.number().int().positive().default(() => Date.now()),
});

export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

export function createSuccessEnvelope<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    success: z.literal(true),
    data: dataSchema,
    meta: paginationMetaSchema.optional(),
  });
}

export const apiErrorDetailSchema = z.object({
  field: z.string().optional(),
  issue: z.string(),
});

export const apiErrorPayloadSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.union([z.array(apiErrorDetailSchema), z.record(z.string(), z.unknown())]).optional(),
});

export const apiErrorResponseSchema = z.object({
  success: z.literal(false),
  error: apiErrorPayloadSchema,
});

export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;

export type ApiResponse<T> = {
  success: true;
  data: T;
  meta?: PaginationMeta;
};
