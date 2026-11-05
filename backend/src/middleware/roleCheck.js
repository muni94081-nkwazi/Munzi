const AppError = require('../utils/AppError');

/**
 * restrictTo
 * Restricts a route to one or more roles. Must be used after `protect`.
 *
 * Usage: router.post('/services', protect, restrictTo('provider'), controller.create)
 * @param  {...string} roles - allowed roles, e.g. 'provider', 'customer'
 */
const restrictTo = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return next(new AppError('You do not have permission to perform this action.', 403));
  }
  next();
};

module.exports = { restrictTo };
