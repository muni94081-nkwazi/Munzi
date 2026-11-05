/**
 * Global error-handling middleware.
 * Must be registered LAST in app.js (after all routes).
 *
 * Handles:
 *  - AppError (operational errors thrown deliberately, e.g. `throw new AppError(...)`)
 *  - PostgreSQL errors (unique violation, foreign key violation, etc.)
 *  - Unexpected/programmer errors (logged, generic message returned to client)
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal server error';

  // Postgres unique violation
  if (err.code === '23505') {
    statusCode = 409;
    message = 'A record with these details already exists.';
  }

  // Postgres foreign key violation
  if (err.code === '23503') {
    statusCode = 400;
    message = 'Referenced record does not exist.';
  }

  // Postgres check constraint violation (e.g. invalid enum value, bad time range)
  if (err.code === '23514') {
    statusCode = 400;
    message = 'Invalid data provided.';
  }

  // JSON body parse errors
  if (err.type === 'entity.parse.failed') {
    statusCode = 400;
    message = 'Malformed JSON in request body.';
  }

  if (!err.isOperational && statusCode === 500) {
    console.error('UNEXPECTED ERROR 💥', err);
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

/**
 * 404 handler for unmatched routes. Registered just before errorHandler.
 */
function notFound(req, res, next) {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
}

module.exports = { errorHandler, notFound };
