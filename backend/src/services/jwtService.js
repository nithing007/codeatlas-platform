/**
 * JWT service
 * Reusable utility for generating and verifying JSON Web Tokens.
 */

const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * Generate a signed JWT.
 * @param {Object} payload - Data to encode (should contain only id and role).
 * @returns {string} Signed JWT string.
 */
const generateToken = (payload) => {
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
};

/**
 * Verify and decode a JWT.
 * @param {string} token - The JWT string to verify.
 * @returns {Object} Decoded payload.
 * @throws {JsonWebTokenError|TokenExpiredError} If token is invalid or expired.
 */
const verifyToken = (token) => {
  return jwt.verify(token, config.jwtSecret);
};

module.exports = { generateToken, verifyToken };
