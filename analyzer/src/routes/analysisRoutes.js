/**
 * Analysis Routes
 *
 * GET  /api/health   — Service health check (public, no auth)
 * POST /api/analyze  — Run static repository analysis (internal service auth required)
 */

const express = require('express');
const { healthCheck, analyze } = require('../controllers/analysisController');
const internalAuth = require('../middleware/internalAuth');

const router = express.Router();

// Public health check — no authentication required
router.get('/health', healthCheck);

// Internal analysis endpoint — requires internal service token
router.post('/analyze', internalAuth, analyze);

module.exports = router;
