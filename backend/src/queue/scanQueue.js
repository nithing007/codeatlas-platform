/**
 * Scan Queue Producer
 *
 * Handles atomic job creation and enqueueing for repository analysis.
 * Uses the Scan document as the persistent, single-document queue record.
 * Enforces the activeScanKey reservation to guarantee that no duplicate scans
 * can exist in QUEUED or RUNNING status for the same repository.
 */

const Scan = require('../models/Scan');
const queueConstants = require('./queueConstants');

/**
 * Calculates exponential backoff delay based on attempt count.
 * Formula: 2^(attempts - 1) * BACKOFF_BASE_MS (e.g. attempt 1 -> 10s, attempt 2 -> 20s, attempt 3 -> 40s).
 *
 * @param {number} attempts - Number of attempts already made.
 * @returns {number} Delay in milliseconds.
 */
function calculateBackoff(attempts) {
  const exponent = Math.max(0, attempts - 1);
  return Math.pow(2, exponent) * queueConstants.BACKOFF_BASE_MS;
}

/**
 * Enqueues a new repository scan job.
 * Atomically inserts the Scan document with queue metadata.
 *
 * @param {Object} params
 * @param {string|import('mongoose').Types.ObjectId} params.repositoryId
 * @param {string|import('mongoose').Types.ObjectId} params.userId
 * @param {string} [params.branch='main']
 * @param {string} [params.commitSha=null]
 * @param {number} [params.priority=0]
 * @returns {Promise<Object>} Created Scan document
 * @throws {Error} 409 SCAN_ALREADY_IN_PROGRESS if a scan is already active for this repository.
 */
async function enqueueScan({ repositoryId, userId, branch = 'main', commitSha = null, priority = 0 }) {
  if (!repositoryId) {
    const error = new Error('Repository ID is required');
    error.statusCode = 400;
    throw error;
  }
  if (!userId) {
    const error = new Error('User ID is required');
    error.statusCode = 400;
    throw error;
  }

  const activeScanKey = repositoryId.toString();

  try {
    const scan = await Scan.create({
      repositoryId,
      userId,
      status: 'QUEUED',
      branch,
      commitSha,
      activeScanKey,
      priority,
      attempts: 0,
      maxAttempts: queueConstants.MAX_ATTEMPTS,
      nextRunAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      leaseExpiresAt: null,
      lastError: null,
    });

    return scan;
  } catch (err) {
    if (err.code === 11000) {
      const error = new Error('A scan is already in progress for this repository.');
      error.statusCode = 409;
      error.code = 'SCAN_ALREADY_IN_PROGRESS';
      throw error;
    }
    throw err;
  }
}

/**
 * Retrieves aggregate metrics of the scan queue.
 *
 * @returns {Promise<{queued: number, running: number, completed: number, failed: number}>}
 */
async function getQueueMetrics() {
  const [queued, running, completed, failed] = await Promise.all([
    Scan.countDocuments({ status: 'QUEUED' }),
    Scan.countDocuments({ status: 'RUNNING' }),
    Scan.countDocuments({ status: 'COMPLETED' }),
    Scan.countDocuments({ status: 'FAILED' }),
  ]);

  return { queued, running, completed, failed };
}

module.exports = {
  enqueueScan,
  calculateBackoff,
  getQueueMetrics,
};

