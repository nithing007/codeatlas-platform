/**
 * Analysis Service
 * Handles business logic for retrieving persisted repository analysis results.
 *
 * Security and ownership invariants:
 * - Enforces repository ownership on the server: never returns analysis results for
 *   repositories not owned by the authenticated user.
 * - Enforces scan ownership: scan must belong to the requested repository and user.
 * - Returns AnalysisResult only for scans that completed successfully (status: COMPLETED).
 * - Never leaks raw file contents, env var values, secrets, internal tokens, or stack traces.
 */

const mongoose = require('mongoose');
const AnalysisResult = require('../models/AnalysisResult');
const Repository = require('../models/Repository');
const Scan = require('../models/Scan');

/**
 * Retrieves the latest successfully completed analysis result for a repository.
 *
 * @param {string|mongoose.Types.ObjectId} userId - Authenticated user ID.
 * @param {string} repositoryId - MongoDB ObjectId of the repository.
 * @returns {Promise<Object>} Safe AnalysisResult object.
 * @throws {Error} 404 if repository not found/owned, or if no completed analysis exists.
 */
const getLatestAnalysis = async (userId, repositoryId) => {
  if (!mongoose.Types.ObjectId.isValid(repositoryId)) {
    const error = new Error('Repository not found.');
    error.statusCode = 404;
    throw error;
  }

  // 1. Verify repository existence and ownership
  const repository = await Repository.findOne({ _id: repositoryId, userId });
  if (!repository) {
    const error = new Error('Repository not found.');
    error.statusCode = 404;
    throw error;
  }

  // 2. Find the latest successfully completed scan for this repository and user
  const latestScan = await Scan.findOne({
    repositoryId: repository._id,
    userId,
    status: 'COMPLETED',
  }).sort({ completedAt: -1, createdAt: -1 });

  if (!latestScan) {
    const error = new Error('No completed analysis found for this repository.');
    error.statusCode = 404;
    error.code = 'ANALYSIS_NOT_FOUND';
    throw error;
  }

  // 3. Retrieve the associated AnalysisResult
  const analysisResult = await AnalysisResult.findOne({
    scanId: latestScan._id,
    repositoryId: repository._id,
    userId,
  });

  if (!analysisResult) {
    const error = new Error('No completed analysis found for this repository.');
    error.statusCode = 404;
    error.code = 'ANALYSIS_NOT_FOUND';
    throw error;
  }

  return analysisResult.toSafeObject ? analysisResult.toSafeObject() : analysisResult;
};

/**
 * Retrieves the analysis result for a specific scan belonging to a repository and user.
 *
 * @param {string|mongoose.Types.ObjectId} userId - Authenticated user ID.
 * @param {string} repositoryId - MongoDB ObjectId of the repository.
 * @param {string} scanId - MongoDB ObjectId of the scan.
 * @returns {Promise<Object>} Safe AnalysisResult object.
 * @throws {Error} 404 if repository or scan not found/owned.
 * @throws {Error} 400 if scan is QUEUED, RUNNING, or FAILED.
 * @throws {Error} 404 if scan is COMPLETED but analysis result is missing.
 */
const getAnalysisByScanId = async (userId, repositoryId, scanId) => {
  if (!mongoose.Types.ObjectId.isValid(repositoryId)) {
    const error = new Error('Repository not found.');
    error.statusCode = 404;
    throw error;
  }

  if (!mongoose.Types.ObjectId.isValid(scanId)) {
    const error = new Error('Scan not found.');
    error.statusCode = 404;
    throw error;
  }

  // 1. Verify repository existence and ownership
  const repository = await Repository.findOne({ _id: repositoryId, userId });
  if (!repository) {
    const error = new Error('Repository not found.');
    error.statusCode = 404;
    throw error;
  }

  // 2. Verify scan belongs strictly to this repository and user
  const scan = await Scan.findOne({
    _id: scanId,
    repositoryId: repository._id,
    userId,
  });

  if (!scan) {
    const error = new Error('Scan not found.');
    error.statusCode = 404;
    throw error;
  }

  // 3. Handle non-completed scan states
  if (scan.status === 'QUEUED' || scan.status === 'RUNNING') {
    const error = new Error(`Analysis is not ready. Scan is currently ${scan.status}.`);
    error.statusCode = 400;
    error.code = 'SCAN_NOT_COMPLETED';
    throw error;
  }

  if (scan.status === 'FAILED') {
    const error = new Error('Analysis is not available because the scan failed.');
    error.statusCode = 400;
    error.code = 'SCAN_FAILED';
    throw error;
  }

  if (scan.status !== 'COMPLETED') {
    const error = new Error(`Analysis is not available. Scan status is ${scan.status}.`);
    error.statusCode = 400;
    error.code = 'SCAN_NOT_COMPLETED';
    throw error;
  }

  // 4. Retrieve AnalysisResult for this scan
  const analysisResult = await AnalysisResult.findOne({
    scanId: scan._id,
    repositoryId: repository._id,
    userId,
  });

  if (!analysisResult) {
    const error = new Error('Analysis result not found for this scan.');
    error.statusCode = 404;
    error.code = 'ANALYSIS_NOT_FOUND';
    throw error;
  }

  return analysisResult.toSafeObject ? analysisResult.toSafeObject() : analysisResult;
};

module.exports = {
  getLatestAnalysis,
  getAnalysisByScanId,
};
