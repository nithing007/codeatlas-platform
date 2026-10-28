/**
 * Admin routes (Development / Verification)
 * Protected routes requiring ADMIN role authorization.
 */

const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');

const router = express.Router();

/**
 * GET /api/admin/test (Development / Verification endpoint)
 * Requires valid authentication AND ADMIN role.
 * USER role receives 403 Forbidden.
 */
router.get('/test', authMiddleware, requireRole('ADMIN'), (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Admin authorization verified successfully',
    user: req.user.toSafeObject(),
  });
});

module.exports = router;
