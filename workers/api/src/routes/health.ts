import { Hono } from "hono";
import {
  HealthCheckResponseData,
  createSuccessEnvelope,
  healthCheckResponseSchema,
} from "@velnox/api-contract";
import { PLATFORM_NAME, PLATFORM_VERSION } from "@velnox/config";
import type { Bindings, Variables } from "../types.js";

export const healthRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const SERVER_START_TIME = Date.now();

function buildHealthData(c: any): HealthCheckResponseData {
  const env = c.env as Bindings | undefined;
  const version = env?.APP_VERSION || PLATFORM_VERSION;
  const service = env?.APP_NAME || PLATFORM_NAME;

  return {
    status: "ok",
    version,
    service,
    uptime: Math.floor((Date.now() - SERVER_START_TIME) / 1000),
    timestamp: Date.now(),
    database: env?.DATABASE_URL ? "connected" : "disconnected",
  };
}

// Root health check endpoint
healthRoutes.get("/health", (c) => {
  const data = buildHealthData(c);
  const response = { success: true as const, data };
  healthCheckResponseSchema.parse(response);
  return c.json(response, 200);
});

// API v1 health check endpoint
healthRoutes.get("/api/v1/health", (c) => {
  const data = buildHealthData(c);
  const response = { success: true as const, data };
  healthCheckResponseSchema.parse(response);
  return c.json(response, 200);
});
