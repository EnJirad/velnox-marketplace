import { z } from "zod";
import type { ApiErrorResponse } from "./envelope.js";

export const API_ERROR_CODES = [
  "BAD_REQUEST",
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "INSUFFICIENT_STOCK",
  "ORDER_EXPIRED",
  "PAYMENT_FAILED",
  "RATE_LIMITED",
  "INTERNAL_SERVER_ERROR",
] as const;

export const apiErrorCodeSchema = z.enum(API_ERROR_CODES);
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const HTTP_STATUS_BY_ERROR_CODE: Record<ApiErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  ORDER_EXPIRED: 410,
  PAYMENT_FAILED: 402,
  INSUFFICIENT_STOCK: 422,
  RATE_LIMITED: 429,
  INTERNAL_SERVER_ERROR: 500,
};

export function createErrorResponse(
  code: ApiErrorCode,
  message: string,
  details?: Array<{ field?: string; issue: string }> | Record<string, unknown>,
): ApiErrorResponse {
  return {
    success: false,
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  };
}
