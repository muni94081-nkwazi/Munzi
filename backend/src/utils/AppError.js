/**
 * AppError - a predictable, operational error with an HTTP status code.
 * Thrown anywhere in controllers/models and caught by the global error handler.
 */
class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;
