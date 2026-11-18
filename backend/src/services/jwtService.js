/**
 * JWT service
 * Reusable utility for generating and verifying JSON Web Tokens.
 */

const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * Validates and resolves the active JWT secret.
 * Enforces that production never silently runs with an insecure default secret.
 * @returns {string}
 */
const getSecret = () => {
  if (config.nodeEnv === 'production') {
    if (!config.jwtSecret || config.jwtSecret === 'default_dev_secret') {
      const err = new Error('FATAL SECURITY ERROR: JWT_SECRET must be explicitly configured in production mode.');
      err.code = 'INSECURE_JWT_SECRET';
      throw err;
    }
  }
  return config.jwtSecret;
};

/**
 * Generate a signed JWT.
 * @param {Object} payload - Data to encode (should contain only id and role).
 * @returns {string} Signed JWT string.
 */
const generateToken = (payload) => {
  return jwt.sign(payload, getSecret(), {
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
  return jwt.verify(token, getSecret());
};

module.exports = { generateToken, verifyToken, getSecret };
