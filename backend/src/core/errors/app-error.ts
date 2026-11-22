export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: any;

  constructor(message: string, code = "INTERNAL_ERROR", statusCode = 500, details?: any) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized", code = "UNAUTHORIZED") {
    super(message, code, 401);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden", code = "FORBIDDEN") {
    super(message, code, 403);
    this.name = "ForbiddenError";
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation Error", details?: any) {
    super(message, "VALIDATION_ERROR", 400, details);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found", code = "NOT_FOUND") {
    super(message, code, 404);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AppError {
  constructor(message = "Resource conflict", code = "CONFLICT") {
    super(message, code, 409);
    this.name = "ConflictError";
  }
}

export class TokenExpiredError extends UnauthorizedError {
  constructor(message = "Token has expired") {
    super(message, "TOKEN_EXPIRED");
    this.name = "TokenExpiredError";
  }
}

export class TokenRevokedError extends UnauthorizedError {
  constructor(message = "Token has been revoked") {
    super(message, "TOKEN_REVOKED");
    this.name = "TokenRevokedError";
  }
}
