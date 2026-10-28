/**
 * Cookie helper utility
 * Centralizes HttpOnly cookie configuration, setting, and clearing for authentication.
 */

const config = require('../config');

/**
 * Returns standard options for setting the authentication HttpOnly cookie.
 * @returns {Object}
 */
const getAuthCookieOptions = () => {
  return {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: config.authCookieMaxAge,
  };
};

/**
 * Sets the authentication JWT in a secure HttpOnly cookie on the response.
 * @param {Object} res - Express response object.
 * @param {string} token - JWT token string.
 */
const setAuthCookie = (res, token) => {
  res.cookie(config.authCookieName, token, getAuthCookieOptions());
};

/**
 * Clears the authentication cookie from the client.
 * @param {Object} res - Express response object.
 */
const clearAuthCookie = (res) => {
  res.clearCookie(config.authCookieName, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    path: '/',
  });
};

module.exports = {
  getAuthCookieOptions,
  setAuthCookie,
  clearAuthCookie,
};
