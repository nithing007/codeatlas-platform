/**
 * Internal Authentication Middleware
 *
 * Verifies that the incoming request carries the correct internal service token.
 * This protects the POST /api/analyze endpoint so only the CodeAtlas Backend
 * can invoke the analyzer — not arbitrary external callers.
 *
 * Authentication scheme:
 *   Authorization: Bearer <ANALYZER_INTERNAL_TOKEN>
 *
 * Security guarantees:
 * - Uses crypto.timingSafeEqual to prevent timing-based token enumeration.
 * - Never logs the expected or received token.
 * - Never returns the token in any error response.
 * - Missing token → 401
 * - Invalid token → 401
 */

const crypto = require('crypto');
const config = require('../config');

/**
 * Extracts the Bearer token from the Authorization header.
 *
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function extractBearerToken(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

/**
 * Performs constant-time comparison of two strings.
 * Returns false immediately if lengths differ (leaks length — acceptable
 * since token format is fixed-length by convention).
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeEqual(a, b) {
  try {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Express middleware that enforces internal service authentication.
 */
const internalAuth = (req, res, next) => {
  const expectedToken = config.analyzerInternalToken;

  // If no token is configured, reject all requests to protected routes.
  // An empty token in production would accept any request — this prevents that.
  if (!expectedToken) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Internal service authentication is not configured.',
      },
    });
  }

  const receivedToken = extractBearerToken(req);

  if (!receivedToken) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing internal service authentication token.',
      },
    });
  }

  if (!safeEqual(receivedToken, expectedToken)) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid internal service authentication token.',
      },
    });
  }

  next();
};

module.exports = internalAuth;
