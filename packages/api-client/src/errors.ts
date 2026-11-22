import type { ApiErrorCode } from "@velnox/api-contract";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | string;
  readonly details?: unknown;

  constructor(status: number, code: ApiErrorCode | string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isAuthError(error: unknown): boolean {
  return error instanceof ApiClientError && (error.status === 401 || error.code === "UNAUTHORIZED");
}

export function isNotFoundError(error: unknown): boolean {
  return error instanceof ApiClientError && (error.status === 404 || error.code === "NOT_FOUND");
}

export function isNetworkError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof Error && (error.name === "AbortError" || error.message.includes("network")))
  );
}
