/**
 * Scan Routes
 * Protected API routes for repository scan lifecycle management.
 *
 * POST /api/repositories/:id/scans                — Start a new scan (QUEUED)
 * GET  /api/repositories/:repositoryId/scans      — List scan history for repository
 * GET  /api/repositories/:repositoryId/scans/:id — Get details of a specific scan
 */

const express = require('express');
const {
  createScan,
  getScan,
  listScans,
} = require('../controllers/scanController');
const {
  getScanAnalysis,
} = require('../controllers/analysisController');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router({ mergeParams: true });

// Enforce authentication on all scan endpoints
router.use(authMiddleware);

// Scan routes
router.post('/', createScan);
router.get('/', listScans);
router.get('/:scanId/analysis', getScanAnalysis);
router.get('/:scanId', getScan);

module.exports = router;
