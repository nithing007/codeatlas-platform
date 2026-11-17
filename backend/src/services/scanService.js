/**
 * Scan Service
 * Handles business logic for repository scan lifecycle, ownership validation, and scan history.
 */

const mongoose = require('mongoose');
const Scan = require('../models/Scan');
const Repository = require('../models/Repository');
const githubService = require('./githubService');
const { enqueueScan } = require('../queue/scanQueue');

/**
 * Creates a new QUEUED scan for an authenticated user's repository.
 *
 * Process:
 * 1. Validates repository ID and ownership.
 * 2. Prevents duplicate active scans (QUEUED or RUNNING) → 409.
 * 3. Resolves the current commit SHA from GitHub for the repo's default branch.
 * 4. Atomically enqueues the Scan document into the persistent MongoDB queue with activeScanKey.
 * 5. Returns the queued Scan document immediately (HTTP 201) for worker execution.
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

  // Prevent duplicate active scans for the same repository (fast path pre-check)
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
  const commitSha = await githubService.resolveCommitSha(repository.owner, repository.name, branch);

  // Enqueue scan in persistent MongoDB queue.
  // Uses enqueueScan to atomically create the Scan record with queue parameters
  // (status: QUEUED, nextRunAt: now, activeScanKey, attempts: 0, maxAttempts: 3).
  // Concurrency protection is enforced via activeScanKey partial unique index.
  const scan = await enqueueScan({
    repositoryId: repository._id,
    userId,
    branch,
    commitSha,
    priority: 0,
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

/**
 * Reconciles stranded scans with status QUEUED or RUNNING on single-instance startup.
 * Marks any interrupted scans as FAILED with a safe, user-readable error message.
 *
 * @returns {Promise<number>} Number of reconciled scans.
 */
const reconcileStrandedScans = async () => {
  try {
    const result = await Scan.updateMany(
      { status: { $in: ['QUEUED', 'RUNNING'] } },
      {
        $set: {
          status: 'FAILED',
          completedAt: new Date(),
          error: 'Scan was interrupted by server restart. Please trigger a new scan.',
          activeScanKey: null,
        },
      }
    );
    const count = result.modifiedCount || 0;
    if (count > 0) {
      console.log(`[startup] Reconciled ${count} stranded scan(s) to FAILED.`);
    }
    return count;
  } catch (err) {
    console.error('[startup] Failed to reconcile stranded scans:', err.message);
    throw err;
  }
};

module.exports = {
  createScan,
  getScan,
  listScans,
  reconcileStrandedScans,
};
