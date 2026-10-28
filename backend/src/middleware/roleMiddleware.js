/**
 * Role-based authorization middleware
 * Checks whether the authenticated user has one of the allowed roles.
 *
 * Usage:
 *   router.get('/admin-route', authMiddleware, requireRole('ADMIN'), handler);
 *   router.get('/multi-role', authMiddleware, requireRole('ADMIN', 'USER'), handler);
 */

/**
 * Middleware factory that restricts route access to specified roles.
 * @param {...string} allowedRoles - List of permitted roles (e.g. 'ADMIN', 'USER').
 * @returns {Function} Express middleware function.
 */
const requireRole = (...allowedRoles) => {
  const normalizedAllowedRoles = allowedRoles.map((r) => r.toUpperCase());

  return (req, res, next) => {
    try {
      if (!req.user) {
        const error = new Error('Authentication required. Please log in.');
        error.statusCode = 401;
        throw error;
      }

      const userRole = (req.user.role || '').toUpperCase();

      if (!normalizedAllowedRoles.includes(userRole)) {
        const error = new Error('Forbidden: You do not have permission to access this resource.');
        error.statusCode = 403;
        throw error;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

module.exports = { requireRole };
