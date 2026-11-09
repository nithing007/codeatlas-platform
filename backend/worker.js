/**
 * CodeAtlas Background Scan Worker Entrypoint
 *
 * Runs as a standalone background process to consume and execute queued repository scans.
 * Ensures that scans survive API server restarts and are processed with controlled concurrency.
 */

'use strict';

require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('./src/config/db');
const { createWorker, reclaimStalledScans } = require('./src/queue/scanWorker');

const concurrency = parseInt(process.env.SCAN_WORKER_CONCURRENCY, 10) || 2;
const pollIntervalMs = parseInt(process.env.SCAN_POLL_INTERVAL_MS, 10) || 1000;

async function startWorkerProcess() {
  try {
    console.log('[worker] Initializing MongoDB connection...');
    await connectDB();

    console.log('[worker] Checking for and recovering any stalled scans on startup...');
    const reclaimed = await reclaimStalledScans();
    if (reclaimed.length > 0) {
      console.log(`[worker] Successfully recovered ${reclaimed.length} stalled scan(s) to QUEUED.`);
    }

    const worker = createWorker({
      concurrency,
      pollIntervalMs,
    });

    worker.start();
    console.log(`[worker] Background scan worker started successfully (PID: ${process.pid}, Concurrency: ${concurrency}).`);

    let isShuttingDown = false;
    const handleShutdown = async (signal) => {
      if (isShuttingDown) return;
      isShuttingDown = true;

      console.log(`\n[worker] Received ${signal}. Starting graceful shutdown...`);
      try {
        await worker.stop();
        console.log('[worker] Worker stopped. Closing MongoDB connection...');
        await mongoose.disconnect();
        console.log('[worker] Clean shutdown completed. Exiting.');
        process.exit(0);
      } catch (err) {
        console.error('[worker] Error during graceful shutdown:', err);
        process.exit(1);
      }
    };

    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));

    process.on('unhandledRejection', (reason) => {
      console.error('[worker] Unhandled Rejection:', reason);
    });

    process.on('uncaughtException', (err) => {
      console.error('[worker] Uncaught Exception:', err);
      handleShutdown('UNCAUGHT_EXCEPTION');
    });
  } catch (err) {
    console.error('[worker] Failed to start worker process:', err);
    process.exit(1);
  }
}

// Only start when invoked directly from CLI
if (require.main === module) {
  startWorkerProcess();
}

module.exports = {
  startWorkerProcess,
};

