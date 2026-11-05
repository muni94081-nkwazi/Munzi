const { verifyToken } = require('../utils/token');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

/**
 * protect
 * Verifies the Bearer token from the Authorization header and attaches
 * the decoded payload ({ id, role, email }) to req.user.
 *
 * Usage: router.get('/me', protect, controller.getMe)
 */
const protect = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AppError('Not authenticated. Please provide a valid Bearer token.', 401);
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = verifyToken(token);
    req.user = decoded; // { id, role, email, iat, exp }
    next();
  } catch (err) {
    throw new AppError('Invalid or expired token.', 401);
  }
});

module.exports = { protect };
