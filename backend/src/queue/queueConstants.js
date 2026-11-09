/**
 * Queue Configuration & Constants
 * Defines timeouts, retry counts, lease durations, and backoff policy for CodeAtlas background jobs.
 */

module.exports = {
  JOB_TYPE: 'REPOSITORY_SCAN',
  DEFAULT_CONCURRENCY: parseInt(process.env.SCAN_WORKER_CONCURRENCY, 10) || 2,
  MAX_ATTEMPTS: parseInt(process.env.SCAN_MAX_ATTEMPTS, 10) || 3,
  LEASE_DURATION_MS: parseInt(process.env.SCAN_LEASE_DURATION_MS, 10) || 60 * 1000, // 60 seconds
  HEARTBEAT_INTERVAL_MS: parseInt(process.env.SCAN_HEARTBEAT_INTERVAL_MS, 10) || 15 * 1000, // 15 seconds
  BACKOFF_BASE_MS: parseInt(process.env.SCAN_BACKOFF_BASE_MS, 10) || 10 * 1000, // 10 seconds base
  POLL_INTERVAL_MS: parseInt(process.env.SCAN_POLL_INTERVAL_MS, 10) || 1000, // 1 second
  STALL_CHECK_INTERVAL_MS: parseInt(process.env.SCAN_STALL_CHECK_INTERVAL_MS, 10) || 30 * 1000, // 30 seconds
  SHUTDOWN_TIMEOUT_MS: parseInt(process.env.SCAN_SHUTDOWN_TIMEOUT_MS, 10) || 30 * 1000, // 30 seconds
};

