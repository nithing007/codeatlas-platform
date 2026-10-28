/**
 * Repository Routes
 * Protected API routes for GitHub repository intake and management.
 *
 * POST   /api/repositories/preview                     — Preview public repository metadata
 * POST   /api/repositories                             — Import repository for authenticated user
 * GET    /api/repositories                             — List authenticated user's repositories
 * GET    /api/repositories/:id                         — Get repository details
 * DELETE /api/repositories/:id                         — Remove repository association
 * POST   /api/repositories/:id/scans                   — Start repository scan (QUEUED)
 * GET    /api/repositories/:repositoryId/scans         — List repository scan history
 * GET    /api/repositories/:repositoryId/scans/:scanId — Get scan status
 */

const express = require('express');
const {
  previewRepository,
  importRepository,
  listRepositories,
  getRepository,
  deleteRepository,
} = require('../controllers/repositoryController');
const {
  getLatestAnalysis,
} = require('../controllers/analysisController');
const scanRouter = require('./scanRoutes');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

// Enforce authentication on all repository routes
router.use(authMiddleware);

// Preview and Import routes
router.post('/preview', previewRepository);
router.post('/', importRepository);

// Analysis routes for repository
router.get('/:repositoryId/analysis/latest', getLatestAnalysis);
router.get('/:id/analysis/latest', getLatestAnalysis);

// Repository collection and item routes
router.get('/', listRepositories);
router.get('/:id', getRepository);
router.delete('/:id', deleteRepository);

// Mount nested scan routes for repository
router.use('/:id/scans', scanRouter);
router.use('/:repositoryId/scans', scanRouter);

module.exports = router;
