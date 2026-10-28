/**
 * Application errors. Each carries the HTTP status the API should answer with,
 * so the error middleware can map them without knowing every error type.
 */
class AppError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
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

module.exports = { AppError, ConfigError, NotFoundError, ValidationError };
