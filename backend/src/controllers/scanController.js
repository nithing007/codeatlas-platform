/**
 * Scan Controller
 * Handles incoming API requests for repository scan lifecycle management.
 */

const scanService = require('../services/scanService');

/**
 * POST /api/repositories/:id/scans or /api/repositories/:repositoryId/scans
 * Starts a new scan job in QUEUED status.
 */
const createScan = async (req, res, next) => {
  try {
    const repositoryId = req.params.repositoryId || req.params.id;
    const scan = await scanService.createScan(req.user._id, repositoryId);

    res.status(201).json({
      success: true,
      message: 'Scan queued successfully.',
      scan: scan.toSafeObject ? scan.toSafeObject() : scan,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/repositories/:repositoryId/scans/:scanId
 * Retrieves details and status of a specific scan.
 */
const getScan = async (req, res, next) => {
  try {
    const repositoryId = req.params.repositoryId || req.params.id;
    const { scanId } = req.params;

    const scan = await scanService.getScan(req.user._id, repositoryId, scanId);

    res.status(200).json({
      success: true,
      scan: scan.toSafeObject ? scan.toSafeObject() : scan,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/repositories/:repositoryId/scans
 * Lists scan history for a repository.
 */
const listScans = async (req, res, next) => {
  try {
    const repositoryId = req.params.repositoryId || req.params.id;
    const result = await scanService.listScans(req.user._id, repositoryId, req.query);

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createScan,
  getScan,
  listScans,
};
