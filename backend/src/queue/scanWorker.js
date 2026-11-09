/**
 * Scan Worker Subsystem
 *
 * Implements persistent background job claiming, execution, heartbeat lease renewal,
 * and crash recovery for CodeAtlas repository scans.
 *
 * Enforces:
 * - Atomic job claiming via single-document findOneAndUpdate
 * - Periodic heartbeat lease extension while jobs are executing
 * - Automatic loss-of-lease detection to prevent stale workers from overwriting database state
 * - Automatic recovery of orphaned/stalled scans whose worker lease has expired
 * - Graceful shutdown with in-flight execution protection
 */

'use strict';

const os = require('os');
const crypto = require('crypto');
const mongoose = require('mongoose');
const Scan = require('../models/Scan');
const queueConstants = require('./queueConstants');
const scanExecutionService = require('../services/scanExecutionService');

/**
 * Generates a globally unique identifier for this worker instance.
 * Format: <hostname>:<process_pid>:<uuid>
 *
 * @returns {string} Unique worker ID
 */
function generateWorkerId() {
  const host = os.hostname() || 'localhost';
  const pid = process.pid;
  const uuid = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(8).toString('hex');
  return `${host}:${pid}:${uuid}`;
}

/**
 * Atomically claims the next eligible QUEUED scan from MongoDB.
 *
 * Criteria for eligibility:
 * - status: 'QUEUED'
 * - nextRunAt: <= current timestamp
 *
 * Order:
 * - priority: descending (-1)
 * - createdAt: ascending (1, FIFO)
 *
 * Atomic mutations on claim:
 * - status: 'RUNNING'
 * - startedAt: current timestamp
 * - lockedAt: current timestamp
 * - lockedBy: workerId
 * - leaseExpiresAt: current timestamp + LEASE_DURATION_MS
 * - attempts: incremented by 1
 *
 * @param {string} workerId - Unique identifier of claiming worker.
 * @returns {Promise<Object|null>} Claimed Scan document or null if none available.
 */
async function claimNextJob(workerId) {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + queueConstants.LEASE_DURATION_MS);

  try {
    const scan = await Scan.findOneAndUpdate(
      {
        status: 'QUEUED',
        nextRunAt: { $lte: now },
      },
      {
        $set: {
          status: 'RUNNING',
          startedAt: now,
          lockedAt: now,
          lockedBy: workerId,
          leaseExpiresAt,
        },
        $inc: { attempts: 1 },
      },
      {
        sort: { priority: -1, createdAt: 1 },
        returnDocument: 'after',
      }
    );

    return scan;
  } catch (err) {
    console.error(`[scanWorker:${workerId}] Database error during job claim:`, err.message);
    throw err;
  }
}

/**
 * Atomically renews the lease on a currently RUNNING scan document.
 * Verifies that the scan is still RUNNING and that lockedBy strictly matches workerId.
 *
 * @param {string|mongoose.Types.ObjectId} scanId - MongoDB ObjectId of the scan
 * @param {string} workerId - Worker claiming ownership
 * @param {number} [leaseDurationMs] - Duration to extend from now (ms)
 * @returns {Promise<Object|null>} Updated scan if renewed, or null if lease was lost/scan not running
 */
async function renewLease(scanId, workerId, leaseDurationMs = queueConstants.LEASE_DURATION_MS) {
  if (!mongoose.Types.ObjectId.isValid(scanId) || !workerId) {
    return null;
  }

  const now = new Date();
  const newLeaseExpiresAt = new Date(now.getTime() + leaseDurationMs);

  try {
    const updated = await Scan.findOneAndUpdate(
      {
        _id: scanId,
        status: 'RUNNING',
        lockedBy: workerId,
      },
      {
        $set: {
          leaseExpiresAt: newLeaseExpiresAt,
        },
      },
      {
        returnDocument: 'after',
      }
    );

    return updated;
  } catch (err) {
    console.error(`[renewLease:${workerId}] Error renewing lease for scan ${scanId}:`, err.message);
    throw err;
  }
}

/**
 * Starts a recurring background heartbeat timer for an active scan.
 * Ensures that overlapping heartbeat operations cannot occur.
 * Automatically halts and invokes onLeaseLost if the worker loses ownership.
 *
 * @param {string|mongoose.Types.ObjectId} scanId - ID of the active Scan
 * @param {string} workerId - Worker ID holding the lease
 * @param {Object} [options={}]
 * @param {number} [options.intervalMs] - Heartbeat frequency (default: 15s)
 * @param {number} [options.leaseDurationMs] - Extension duration (default: 60s)
 * @param {Function} [options.onLeaseLost] - Callback invoked when worker loses ownership
 * @returns {{ stop: Function, isActive: Function }} Control handle
 */
function startHeartbeat(scanId, workerId, options = {}) {
  const intervalMs = options.intervalMs || queueConstants.HEARTBEAT_INTERVAL_MS;
  const leaseDurationMs = options.leaseDurationMs || queueConstants.LEASE_DURATION_MS;
  const onLeaseLost = options.onLeaseLost || (() => {});

  let active = true;
  let inFlight = false;
  let timer = null;
  let currentPromise = null;

  async function performHeartbeat() {
    if (!active || inFlight) return;
    inFlight = true;

    currentPromise = (async () => {
      try {
        const renewed = await renewLease(scanId, workerId, leaseDurationMs);
        if (!renewed) {
          console.warn(`[heartbeat:${workerId}] Lost lease ownership for scan ${scanId}. Stopping heartbeat.`);
          active = false;
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          onLeaseLost(scanId);
          return;
        }
      } catch (err) {
        console.error(`[heartbeat:${workerId}] Heartbeat update failed for scan ${scanId}:`, err.message);
      } finally {
        inFlight = false;
        currentPromise = null;
        if (active) {
          timer = setTimeout(performHeartbeat, intervalMs);
        }
      }
    })();

    await currentPromise;
  }

  timer = setTimeout(performHeartbeat, intervalMs);

  return {
    stop: async () => {
      active = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (currentPromise) {
        await currentPromise;
      }
    },
    isActive: () => active,
  };
}

/**
 * Atomically reclaims a single stalled scan whose lease has expired.
 * Requeues the scan by resetting status to 'QUEUED' and clearing stale worker ownership,
 * while preserving activeScanKey so repository locking remains active.
 *
 * @param {Object} scan - Candidate scan document
 * @param {Date} [now=new Date()] - Reference time for expiration comparison
 * @returns {Promise<Object|null>} Reclaimed scan document, or null if cannot reclaim
 */
async function reclaimSingleScan(scan, now = new Date()) {
  if (!scan || !scan._id) return null;

  const filter = {
    _id: scan._id,
    status: 'RUNNING',
    $or: [
      { leaseExpiresAt: { $lt: now } },
      { leaseExpiresAt: null },
    ],
  };

  if (scan.lockedBy) {
    filter.lockedBy = scan.lockedBy;
  }

  const update = {
    $set: {
      status: 'QUEUED',
      lockedBy: null,
      lockedAt: null,
      leaseExpiresAt: null,
      nextRunAt: now,
      lastError: `Lease expired while locked by ${scan.lockedBy || 'unknown'}. Requeued automatically.`,
    },
    // activeScanKey is preserved so the repository reservation remains held
  };

  try {
    const updated = await Scan.findOneAndUpdate(filter, update, { returnDocument: 'after' });
    return updated;
  } catch (err) {
    console.error(`[reclaim] Failed to reclaim scan ${scan._id}:`, err.message);
    return null;
  }
}

/**
 * Queries MongoDB for RUNNING scans with expired leases and safely requeues them.
 *
 * @param {Object} [options={}]
 * @param {Date} [options.now] - Override current timestamp for testing
 * @param {number} [options.limit=50] - Maximum candidate batch size
 * @returns {Promise<Array<Object>>} Array of successfully reclaimed scans
 */
async function reclaimStalledScans(options = {}) {
  const now = options.now || new Date();
  const limit = options.limit || 50;

  try {
    const candidates = await Scan.find({
      status: 'RUNNING',
      $or: [
        { leaseExpiresAt: { $lt: now } },
        { leaseExpiresAt: null, lockedAt: { $lt: new Date(now.getTime() - queueConstants.LEASE_DURATION_MS) } },
        { leaseExpiresAt: null, lockedAt: null },
      ],
    })
      .sort({ createdAt: 1 })
      .limit(limit);

    if (!candidates || candidates.length === 0) {
      return [];
    }

    const reclaimedScans = [];
    for (const candidate of candidates) {
      const reclaimed = await reclaimSingleScan(candidate, now);
      if (reclaimed) {
        reclaimedScans.push(reclaimed);
        console.log(
          `[reclaim] Scan ${reclaimed._id} lease expired (worker: ${candidate.lockedBy || 'unknown'}). Requeued to QUEUED.`
        );
      }
    }

    return reclaimedScans;
  } catch (err) {
    console.error('[reclaim] Error during stalled scans recovery:', err.message);
    throw err;
  }
}

/**
 * Creates a configurable worker instance.
 *
 * @param {Object} [options={}]
 * @param {string} [options.workerId] - Custom worker ID
 * @param {number} [options.concurrency] - Max concurrent in-flight jobs
 * @param {number} [options.pollIntervalMs] - Polling interval in ms
 * @param {number} [options.heartbeatIntervalMs] - Heartbeat frequency (ms)
 * @param {number} [options.leaseDurationMs] - Lease renewal extension (ms)
 * @param {number} [options.stallCheckIntervalMs] - Stalled lease check frequency (ms)
 * @param {number} [options.shutdownTimeoutMs] - Max wait time for active jobs on shutdown
 * @returns {Object} Worker instance with start, stop, tick, and getStatus methods
 */
function createWorker(options = {}) {
  const workerId = options.workerId || generateWorkerId();
  const concurrency = Math.max(1, options.concurrency || queueConstants.DEFAULT_CONCURRENCY);
  const pollIntervalMs = options.pollIntervalMs || queueConstants.POLL_INTERVAL_MS;
  const heartbeatIntervalMs = options.heartbeatIntervalMs || queueConstants.HEARTBEAT_INTERVAL_MS;
  const leaseDurationMs = options.leaseDurationMs || queueConstants.LEASE_DURATION_MS;
  const stallCheckIntervalMs = options.stallCheckIntervalMs || queueConstants.STALL_CHECK_INTERVAL_MS;
  const shutdownTimeoutMs = options.shutdownTimeoutMs || queueConstants.SHUTDOWN_TIMEOUT_MS;

  let running = false;
  let stopping = false;
  let activeJobs = 0;
  let pollTimer = null;
  let stallCheckTimer = null;
  const inFlightJobs = new Set();

  /**
   * Processes a single claimed scan using scanExecutionService.
   * Manages active heartbeat and tracks loss of lease.
   *
   * @param {Object} scan - Claimed Scan document
   */
  async function processJob(scan) {
    let leaseLost = false;

    const heartbeat = startHeartbeat(scan._id, workerId, {
      intervalMs: heartbeatIntervalMs,
      leaseDurationMs,
      onLeaseLost: (scanId) => {
        leaseLost = true;
        console.warn(`[scanWorker:${workerId}] Scan ${scanId} lease was lost during execution.`);
      },
    });

    try {
      await scanExecutionService.executeScan(scan._id, {
        alreadyClaimed: true,
        claimedScan: scan,
        workerId,
        isLeaseLost: () => leaseLost,
      });
    } catch (err) {
      console.error(`[scanWorker:${workerId}] Error executing scan ${scan._id}:`, err.message);
    } finally {
      await heartbeat.stop();
    }
  }

  /**
   * Main polling tick.
   * Claims eligible jobs up to concurrency limit.
   */
  async function tick() {
    if (!running || stopping) return;

    try {
      while (activeJobs < concurrency && running && !stopping) {
        const scan = await claimNextJob(workerId);
        if (!scan) {
          // No eligible jobs in queue
          break;
        }

        activeJobs++;
        const jobPromise = processJob(scan);
        inFlightJobs.add(jobPromise);

        jobPromise
          .catch((err) => {
            console.error(`[scanWorker:${workerId}] Uncaught job execution error:`, err.message);
          })
          .finally(() => {
            activeJobs--;
            inFlightJobs.delete(jobPromise);

            // If still running, trigger an immediate tick to claim next job without waiting for poll interval
            if (running && !stopping) {
              setImmediate(() => {
                tick().catch((e) => {
                  console.error(`[scanWorker:${workerId}] Error in post-job tick:`, e.message);
                });
              });
            }
          });
      }
    } catch (err) {
      console.error(`[scanWorker:${workerId}] Error in polling tick:`, err.message);
    } finally {
      // Schedule next polling tick if still active
      if (running && !stopping) {
        pollTimer = setTimeout(() => {
          tick().catch((e) => {
            console.error(`[scanWorker:${workerId}] Error in scheduled tick:`, e.message);
          });
        }, pollIntervalMs);
      }
    }
  }

  /**
   * Periodic sweep for expired leases.
   */
  async function runStallCheck() {
    if (!running || stopping) return;
    try {
      await reclaimStalledScans();
    } catch (err) {
      console.error(`[scanWorker:${workerId}] Stalled scan sweep failed:`, err.message);
    }
  }

  /**
   * Starts the background worker polling and stall-detection loops.
   */
  function start() {
    if (running) return;
    running = true;
    stopping = false;
    console.log(
      `[scanWorker:${workerId}] Started with concurrency ${concurrency}, poll interval ${pollIntervalMs}ms, heartbeat ${heartbeatIntervalMs}ms.`
    );

    tick().catch((err) => {
      console.error(`[scanWorker:${workerId}] Initial tick failed:`, err.message);
    });

    // Start periodic stalled scans check
    stallCheckTimer = setInterval(runStallCheck, stallCheckIntervalMs);
    if (stallCheckTimer.unref) stallCheckTimer.unref();
  }

  /**
   * Gracefully shuts down the worker.
   * Stops accepting new jobs and waits for in-flight jobs to complete up to shutdownTimeoutMs.
   * Active in-flight jobs continue running heartbeats while finishing.
   *
   * @returns {Promise<void>}
   */
  async function stop() {
    if (!running && !stopping) return;

    console.log(`[scanWorker:${workerId}] Stopping worker. Waiting for ${activeJobs} active job(s)...`);
    stopping = true;
    running = false;

    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }

    if (stallCheckTimer) {
      clearInterval(stallCheckTimer);
      stallCheckTimer = null;
    }

    if (inFlightJobs.size === 0) {
      console.log(`[scanWorker:${workerId}] No active jobs. Stopped immediately.`);
      return;
    }

    // Wait for in-flight jobs to complete or timeout
    const timeoutPromise = new Promise((resolve) => setTimeout(resolve, shutdownTimeoutMs));
    const allJobsSettled = Promise.allSettled(Array.from(inFlightJobs));

    await Promise.race([allJobsSettled, timeoutPromise]);
    console.log(`[scanWorker:${workerId}] Shutdown complete. Remaining active: ${inFlightJobs.size}.`);
  }

  /**
   * Returns the current status of the worker.
   */
  function getStatus() {
    return {
      workerId,
      concurrency,
      activeJobs,
      running,
      stopping,
    };
  }

  return {
    workerId,
    concurrency,
    pollIntervalMs,
    start,
    stop,
    tick,
    getStatus,
    claimNextJob: () => claimNextJob(workerId),
    reclaimStalledScans,
  };
}

module.exports = {
  generateWorkerId,
  claimNextJob,
  renewLease,
  startHeartbeat,
  reclaimSingleScan,
  reclaimStalledScans,
  createWorker,
};
