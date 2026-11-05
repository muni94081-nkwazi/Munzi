/**
 * Wraps an async route/controller function and forwards any rejected
 * promise to Express's error-handling middleware via next(err).
 *
 * Usage: router.get('/', asyncHandler(controllerFn));
 */
module.exports = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
