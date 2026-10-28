/**
 * Authentication routes
 * POST /api/auth/request-otp     — Request a new OTP
 * POST /api/auth/verify-otp      — Verify OTP and set auth cookie
 * GET  /api/auth/google          — Initiate Google OAuth flow
 * GET  /api/auth/google/callback — Google OAuth callback (sets auth cookie and redirects)
 * POST /api/auth/logout          — Clear auth cookie
 * GET  /api/auth/me              — Get current authenticated user info (cookie/bearer)
 * GET  /api/auth/protected       — Protected development test route
 */

const express = require('express');
const {
  requestOtp,
  verifyOtp,
  googleAuth,
  googleCallback,
  logout,
  getMe,
  getProtectedTest,
} = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

// Email OTP routes
router.post('/request-otp', requestOtp);
router.post('/verify-otp', verifyOtp);

// Google OAuth routes
router.get('/google', googleAuth);
router.get('/google/callback', googleCallback);

// Session / User routes
router.post('/logout', logout);
router.get('/me', authMiddleware, getMe);
router.get('/protected', authMiddleware, getProtectedTest);

module.exports = router;
