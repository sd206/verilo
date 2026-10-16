/** Errors handlers throw; the web layer maps them to responses (401/403/404/429/400). */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "RATE_LIMITED" | "VALIDATION" | "CONFLICT" | "MFA_REQUIRED",
    public readonly status: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
export class UnauthenticatedError extends AppError {
  constructor(message = "Sign in required") {
    super(message, "UNAUTHENTICATED", 401);
  }
}
export class ForbiddenError extends AppError {
  constructor(message = "You don't have permission to do that") {
    super(message, "FORBIDDEN", 403);
  }
}
/** Also used for records in another firm, so their existence is not revealed (T12). */
export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(message, "NOT_FOUND", 404);
  }
}
export class RateLimitedError extends AppError {
  constructor(message = "Too many attempts. Try again later.") {
    super(message, "RATE_LIMITED", 429);
  }
}
export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, "VALIDATION", 400);
  }
}
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, "CONFLICT", 409);
  }
}
export class MfaRequiredError extends AppError {
  constructor(message = "Multi-factor authentication required") {
    super(message, "MFA_REQUIRED", 403);
  }
}
