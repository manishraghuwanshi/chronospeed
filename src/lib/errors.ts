/**
 * Error shapes shared by the DAL, Server Actions and Route Handlers.
 *
 * Principle (`docs/security-plan.md` §12): production responses are generic —
 * never a stack trace, SQL fragment, or internal path. These classes carry a
 * safe `code` and `message` for the caller, plus an internal `cause` for the
 * server log only. `toPublicError` is the single place that decides what a
 * browser is allowed to see.
 */

export type PublicErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "internal_error";

export interface PublicError {
  readonly error: {
    readonly code: PublicErrorCode;
    readonly message: string;
  };
}

/**
 * Base class for errors that are safe to map to a client response.
 * Anything that is *not* an `AppError` is treated as unexpected and sanitized.
 */
export class AppError extends Error {
  readonly code: PublicErrorCode;
  /** HTTP status the error maps to. */
  readonly status: number;
  /** Safe, generic, user-facing message. Must not contain internal detail. */
  readonly publicMessage: string;

  constructor(
    code: PublicErrorCode,
    publicMessage: string,
    status: number,
    options?: { cause?: unknown },
  ) {
    super(`${code}: ${publicMessage}`, { cause: options?.cause });
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

export class BadRequestError extends AppError {
  constructor(message = "The request could not be processed.", options?: { cause?: unknown }) {
    super("bad_request", message, 400, options);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "You need to sign in to continue.", options?: { cause?: unknown }) {
    super("unauthorized", message, 401, options);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have access to this resource.", options?: { cause?: unknown }) {
    super("forbidden", message, 403, options);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "The requested resource was not found.", options?: { cause?: unknown }) {
    super("not_found", message, 404, options);
  }
}

export class ConflictError extends AppError {
  constructor(message = "The request conflicts with the current state.", options?: { cause?: unknown }) {
    super("conflict", message, 409, options);
  }
}

/**
 * A database or configuration failure. The real reason is kept in `cause` and
 * logged server-side; the browser only ever sees a generic message.
 */
export class DatabaseError extends AppError {
  constructor(options?: { cause?: unknown }) {
    super("internal_error", "Something went wrong. Please try again.", 500, options);
  }
}

/** Narrow an unknown thrown value to a client-safe payload plus a loggable cause. */
export function toPublicError(error: unknown): {
  readonly publicError: PublicError;
  readonly status: number;
} {
  if (error instanceof AppError) {
    return {
      publicError: { error: { code: error.code, message: error.publicMessage } },
      status: error.status,
    };
  }

  return {
    publicError: {
      error: { code: "internal_error", message: "Something went wrong. Please try again." },
    },
    status: 500,
  };
}