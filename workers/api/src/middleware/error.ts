import type { ErrorHandler, NotFoundHandler } from "hono";
import { type ApiErrorCode, createErrorResponse } from "@velnox/api-contract";
import type { Bindings, Variables } from "../types.js";

/**
 * Standardized Hono Error Handler conforming to @velnox/api-contract
 */
export const errorHandler: ErrorHandler<{ Bindings: Bindings; Variables: Variables }> = (err, c) => {
  console.error(`[API Error] [${c.get("requestId")}] ${err.message}`, err.stack);

  let statusCode = 500;
  let errorCode: ApiErrorCode = "INTERNAL_SERVER_ERROR";
  let message = "An internal server error occurred.";
  let details: Array<{ field?: string; issue: string }> | Record<string, unknown> | undefined = undefined;

  if ("status" in err && typeof err.status === "number") {
    statusCode = err.status;
  }

  if ("code" in err && typeof err.code === "string") {
    errorCode = err.code as ApiErrorCode;
  }

  if (statusCode === 400) {
    errorCode = "VALIDATION_ERROR";
    message = err.message || "Invalid request parameters.";
  } else if (statusCode === 401) {
    errorCode = "UNAUTHORIZED";
    message = err.message || "Authentication is required.";
  } else if (statusCode === 403) {
    errorCode = "FORBIDDEN";
    message = err.message || "You do not have permission to access this resource.";
  } else if (statusCode === 404) {
    errorCode = "NOT_FOUND";
    message = err.message || "The requested resource was not found.";
  } else if (statusCode === 409) {
    errorCode = "CONFLICT";
    message = err.message || "A conflict occurred with current system state.";
  }

  const envelope = createErrorResponse(errorCode, message, details);
  return c.json(envelope, statusCode as any);
};

/**
 * Standardized 404 Not Found Handler conforming to @velnox/api-contract
 */
export const notFoundHandler: NotFoundHandler<{ Bindings: Bindings; Variables: Variables }> = (c) => {
  const envelope = createErrorResponse(
    "NOT_FOUND",
    `Route ${c.req.method} ${c.req.path} not found.`,
  );
  return c.json(envelope, 404);
};
