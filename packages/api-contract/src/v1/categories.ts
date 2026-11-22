import { z } from "zod";
import { idSchema, slugSchema } from "@velnox/validation";
import { createSuccessEnvelope } from "../common/envelope.js";

export const categorySchema = z.object({
  id: idSchema,
  parentId: idSchema.nullable().optional(),
  name: z.string().min(1).max(100),
  nameTh: z.string().max(100).optional(),
  nameEn: z.string().max(100).optional(),
  nameMy: z.string().max(100).optional(),
  slug: slugSchema,
  iconUrl: z.string().url().nullable().optional(),
  displayOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

export const categoryTreeNodeSchema: z.ZodType<CategoryTreeNode> = categorySchema.extend({
  children: z.lazy(() => z.array(categoryTreeNodeSchema)).default([]),
});

export type Category = z.infer<typeof categorySchema>;
export type CategoryTreeNode = Category & {
  children: CategoryTreeNode[];
};

export const categoryListResponseSchema = createSuccessEnvelope(z.array(categoryTreeNodeSchema));
export const categoryDetailResponseSchema = createSuccessEnvelope(categorySchema);
