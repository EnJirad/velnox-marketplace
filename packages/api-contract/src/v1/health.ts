import { z } from "zod";
import { createSuccessEnvelope } from "../common/envelope.js";

export const healthCheckResponseDataSchema = z.object({
  status: z.enum(["ok", "degraded", "down"]),
  version: z.string(),
  service: z.string(),
  uptime: z.number().nonnegative(),
  timestamp: z.number().int().positive(),
  database: z.enum(["connected", "disconnected"]),
});

export const healthCheckResponseSchema = createSuccessEnvelope(healthCheckResponseDataSchema);

export type HealthCheckResponseData = z.infer<typeof healthCheckResponseDataSchema>;
export type HealthCheckResponse = z.infer<typeof healthCheckResponseSchema>;
