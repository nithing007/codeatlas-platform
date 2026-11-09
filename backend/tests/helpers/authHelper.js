/**
 * Authentication Test Helper
 *
 * Provides utilities to create test users and valid session tokens / cookies.
 */

const User = require('../../src/models/User');
const { generateToken } = require('../../src/services/jwtService');
const config = require('../../src/config');

/**
 * Creates an authenticated test user in the test database and returns auth artifacts.
 * @param {Object} [overrides]
 * @returns {Promise<{user: Object, token: string, cookie: string}>}
 */
async function createAuthenticatedUser(overrides = {}) {
  const uniqueSuffix = Date.now() + Math.random().toString(36).substring(2, 7);
  const user = await User.create({
    email: `test-user-${uniqueSuffix}@codeatlas.test`,
    name: 'Test User',
    role: 'user',
    authProvider: 'email',
    ...overrides,
  });

  const token = generateToken({ id: user._id.toString(), role: user.role });
  const cookie = `${config.authCookieName}=${token}`;

  return { user, token, cookie };
}

/**
 * Generates an authentication cookie for an arbitrary user ID without DB insertion.
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {string} [role='user']
 * @returns {{token: string, cookie: string}}
 */
function createAuthCookieForId(userId, role = 'user') {
  const token = generateToken({ id: userId.toString(), role });
  const cookie = `${config.authCookieName}=${token}`;
  return { token, cookie };
}

module.exports = {
  createAuthenticatedUser,
  createAuthCookieForId,
};

