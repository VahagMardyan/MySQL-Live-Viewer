/**
 * Application errors. Each carries the HTTP status the API should answer with,
 * so the error middleware can map them without knowing every error type.
 * `code` is a short machine-readable reason the frontend can react to.
 */
class AppError extends Error {
  constructor(message, status = 500, code = undefined) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
  }
}

class ConfigError extends AppError {
  constructor(message) {
    super(message, 500);
  }
}

class NotFoundError extends AppError {
  constructor(message) {
    super(message, 404);
  }
}

class ValidationError extends AppError {
  constructor(message) {
    super(message, 400);
  }
}

/** Editing is locked: no write session, or it expired. The frontend asks for the password again. */
class LockedError extends AppError {
  constructor(message = "Editing is locked. Enter your MySQL password to continue.") {
    super(message, 401, "locked");
  }
}

class AuthError extends AppError {
  constructor(message) {
    super(message, 401, "auth");
  }
}

class ConflictError extends AppError {
  constructor(message) {
    super(message, 409, "conflict");
  }
}

class TooManyAttemptsError extends AppError {
  constructor(retryAfterSec) {
    super(`Too many wrong passwords. Try again in ${retryAfterSec} seconds.`, 429, "throttled");
    this.retryAfterSec = retryAfterSec;
  }
}

module.exports = {
  AppError, ConfigError, NotFoundError, ValidationError,
  LockedError, AuthError, ConflictError, TooManyAttemptsError,
};
