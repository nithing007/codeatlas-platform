/**
 * Scan Service
 * Handles business logic for repository scan lifecycle, ownership validation, and scan history.
 */

const mongoose = require('mongoose');
const Scan = require('../models/Scan');
const Repository = require('../models/Repository');
const { resolveCommitSha } = require('./githubService');
const scanExecutionService = require('./scanExecutionService');

/**
 * Creates a new QUEUED scan for an authenticated user's repository.
 *
 * Process:
 * 1. Validates repository ID and ownership.
 * 2. Prevents duplicate active scans (QUEUED or RUNNING) → 409.
 * 3. Resolves the current commit SHA from GitHub for the repo's default branch.
 * 4. Creates the Scan with server-controlled fields (branch, commitSha, status).
 * 5. Schedules async in-process execution (can be replaced by a queue worker).
 *
 * @param {string|mongoose.Types.ObjectId} userId - Authenticated user ID.
 * @param {string} repositoryId - MongoDB ObjectId of the repository.
 * @returns {Promise<Object>} Created Scan document.
 * @throws {Error} 404 if repository not found/not owned. 409 if scan already active.
 */
const createScan = async (userId, repositoryId) => {
  if (!mongoose.Types.ObjectId.isValid(repositoryId)) {
    const error = new Error('Repository not found.');
    error.statusCode = 404;
    throw error;
  }

  // Verify repository existence and ownership
  const repository = await Repository.findOne({ _id: repositoryId, userId });
  if (!repository) {
    const error = new Error('Repository not found.');
    error.statusCode = 404;
    throw error;
  }

  // Prevent duplicate active scans for the same repository
  const activeScan = await Scan.findOne({
    repositoryId: repository._id,
    status: { $in: ['QUEUED', 'RUNNING'] },
  });

  if (activeScan) {
    const error = new Error('A scan is already in progress for this repository.');
    error.statusCode = 409;
    error.code = 'SCAN_ALREADY_IN_PROGRESS';
    throw error;
  }

  // Resolve the exact current commit SHA for the repository's default branch.
  // This ensures the scan represents a deterministic snapshot.
  const branch = repository.defaultBranch || 'main';
  const commitSha = await resolveCommitSha(repository.owner, repository.name, branch);

  // Create scan with server-controlled lifecycle fields.
  // The client cannot supply: status, commitSha, startedAt, completedAt,
  // filesScanned, findingsCount, or error.
  const scan = await Scan.create({
    repositoryId: repository._id,
    userId,
    status:    'QUEUED',
    branch,
    commitSha,
  });

  // Schedule async in-process execution.
  // setImmediate fires after the current event-loop tick so the HTTP response
  // is sent before execution begins. Replacing setImmediate with a queue
  // publisher requires no changes to executeScan itself.
  setImmediate(() => {
    scanExecutionService.executeScan(scan._id).catch((err) => {
      console.error(`[scanService] Unhandled error in executeScan for scan ${scan._id}:`, err.message);
    });
  });

  return scan;
};

/**
 * Retrieves a single scan belonging to the repository and authenticated user.
 *
 * @param {string|mongoose.Types.ObjectId} userId - Authenticated user ID.
 * @param {string} repositoryId - MongoDB ObjectId of the repository.
 * @param {string} scanId - MongoDB ObjectId of the scan.
 * @returns {Promise<Object>} Scan document.
 * @throws {Error} 404 Not Found if the scan/repository is not found or not owned by user.
 */
const getScan = async (userId, repositoryId, scanId) => {
  if (!mongoose.Types.ObjectId.isValid(repositoryId) || !mongoose.Types.ObjectId.isValid(scanId)) {
    const error = new Error('Scan not found.');
    error.statusCode = 404;
    throw error;
  }

  // Verify repository belongs to user
  const repository = await Repository.findOne({
    _id: repositoryId,
    userId,
  });

  if (!repository) {
    const error = new Error('Repository not found.');
    error.statusCode = 404;
    throw error;
  }

  // Find scan belonging to this repository and user
  const scan = await Scan.findOne({
    _id: scanId,
    repositoryId,
    userId,
  });

  if (!scan) {
    const error = new Error('Scan not found.');
    error.statusCode = 404;
    throw error;
  }

  return scan;
};

/**
 * Lists scan history for a repository belonging to the authenticated user.
 *
 * @param {string|mongoose.Types.ObjectId} userId - Authenticated user ID.
 * @param {string} repositoryId - MongoDB ObjectId of the repository.
 * @param {Object} queryOptions - Pagination query options (page, limit).
 * @returns {Promise<Object>} Object containing scans array and pagination metadata.
 * @throws {Error} 404 Not Found if the repository is not found or not owned by user.
 */
const listScans = async (userId, repositoryId, queryOptions = {}) => {
  if (!mongoose.Types.ObjectId.isValid(repositoryId)) {
    const error = new Error('Repository not found.');
    error.statusCode = 404;
    throw error;
  }

  // Verify repository belongs to user
  const repository = await Repository.findOne({
    _id: repositoryId,
    userId,
  });

  if (!repository) {
    const error = new Error('Repository not found.');
    error.statusCode = 404;
    throw error;
  }

  const page = Math.max(1, parseInt(queryOptions.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(queryOptions.limit, 10) || 20));
  const skip = (page - 1) * limit;

  const [scans, total] = await Promise.all([
    Scan.find({ repositoryId, userId }).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Scan.countDocuments({ repositoryId, userId }),
  ]);

  return {
    scans: scans.map((s) => s.toSafeObject()),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
};

module.exports = {
  createScan,
  getScan,
  listScans,
};
