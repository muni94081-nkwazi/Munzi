const jwt = require('jsonwebtoken');
const jwtConfig = require('../config/jwt');

/**
 * Sign a JWT for a given user payload.
 * @param {{ id: string, role: string, email: string }} payload
 * @returns {string} signed JWT
 */
function signToken(payload) {
  return jwt.sign(payload, jwtConfig.secret, { expiresIn: jwtConfig.expiresIn });
}

/**
 * Verify and decode a JWT. Throws if invalid/expired.
 * @param {string} token
 */
function verifyToken(token) {
  return jwt.verify(token, jwtConfig.secret);
}

module.exports = { signToken, verifyToken };
