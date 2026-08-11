/** Domain error taxonomy. HTTP layer maps `.status`. */
export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
    readonly meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends AppError {
  constructor(what: string, meta?: Record<string, unknown>) {
    super(`${what} not found`, "not_found", 404, meta);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, meta?: Record<string, unknown>) {
    super(message, "validation", 422, meta);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, meta?: Record<string, unknown>) {
    super(message, "conflict", 409, meta);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "unauthorized") {
    super(message, "unauthorized", 401);
  }
}

export class FeatureDisabledError extends AppError {
  constructor(feature: string) {
    super(`feature disabled: ${feature}`, "feature_disabled", 403, { feature });
  }
}
