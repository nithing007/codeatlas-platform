/**
 * Authentication middleware
 * Extracts and verifies JWT from HttpOnly cookie (primary) or Authorization header (fallback),
 * fetches user from MongoDB, and attaches safe user object to req.user.
 */

const { verifyToken } = require('../services/jwtService');
const User = require('../models/User');
const config = require('../config');

const authMiddleware = async (req, res, next) => {
  try {
    let token = null;

    // 1. Primary: Extract from configured HttpOnly cookie
    if (req.cookies && req.cookies[config.authCookieName]) {
      token = req.cookies[config.authCookieName];
    }

    // 2. Fallback: Extract from Authorization Bearer header (for API / backward compatibility)
    if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      const error = new Error('Authentication required. Please log in.');
      error.statusCode = 401;
      throw error;
    }

    // Verify token signature and expiration
    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (err) {
      const error = new Error('Invalid or expired authentication session');
      error.statusCode = 401;
      throw error;
    }

    // Find authenticated user in database
    const user = await User.findById(decoded.id);

    if (!user) {
      const error = new Error('User associated with this session no longer exists');
      error.statusCode = 401;
      throw error;
    }

    // Attach authenticated user to request
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = authMiddleware;
