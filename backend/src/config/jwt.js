/**
 * Centralized JWT configuration.
 * Reads secret/expiry from environment variables so they're never hardcoded.
 */
module.exports = {
  secret: process.env.JWT_SECRET,
  expiresIn: process.env.JWT_EXPIRES_IN || '7d',
};
