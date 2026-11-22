import { z } from "zod";
import { paginationQuerySchema } from "@velnox/validation";
import { createSuccessEnvelope } from "./envelope.js";

export { paginationQuerySchema };

export function createPaginatedResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return createSuccessEnvelope(z.array(itemSchema));
}
