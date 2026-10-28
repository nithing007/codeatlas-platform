/**
 * Analysis Controller
 * Request handlers for retrieving repository analysis results.
 */

const analysisService = require('../services/analysisService');

/**
 * GET /api/repositories/:repositoryId/analysis/latest
 * Retrieve the latest successfully completed analysis result for a repository.
 */
const getLatestAnalysis = async (req, res, next) => {
  try {
    const repositoryId = req.params.repositoryId || req.params.id;
    const analysis = await analysisService.getLatestAnalysis(req.user._id, repositoryId);

    res.status(200).json({
      success: true,
      analysis,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/repositories/:repositoryId/scans/:scanId/analysis
 * Retrieve the analysis result for a specific completed scan.
 */
const getScanAnalysis = async (req, res, next) => {
  try {
    const repositoryId = req.params.repositoryId || req.params.id;
    const { scanId } = req.params;
    const analysis = await analysisService.getAnalysisByScanId(req.user._id, repositoryId, scanId);

    res.status(200).json({
      success: true,
      analysis,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getLatestAnalysis,
  getScanAnalysis,
};
