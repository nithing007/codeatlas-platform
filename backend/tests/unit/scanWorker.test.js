/**
 * Unit Tests: Scan Worker Subsystem (Phase 7B.2B & 7B.2C)
 */

const mongoose = require('mongoose');
const {
  generateWorkerId,
  claimNextJob,
  renewLease,
  startHeartbeat,
  reclaimSingleScan,
  reclaimStalledScans,
  createWorker,
} = require('../../src/queue/scanWorker');
const Scan = require('../../src/models/Scan');
const scanExecutionService = require('../../src/services/scanExecutionService');
const queueConstants = require('../../src/queue/queueConstants');

describe('Scan Worker Unit Tests (Phase 7B.2B & 7B.2C)', () => {
  describe('Worker ID Generation', () => {
    test('generates worker ID in <hostname>:<pid>:<uuid> format', () => {
      const id1 = generateWorkerId();
      const id2 = generateWorkerId();

      expect(typeof id1).toBe('string');
      expect(typeof id2).toBe('string');
      expect(id1).not.toBe(id2);

      const parts = id1.split(':');
      expect(parts.length).toBeGreaterThanOrEqual(3);
      expect(parts[1]).toBe(process.pid.toString());
    });
  });

  describe('claimNextJob Unit Specifications', () => {
    test('builds atomic findOneAndUpdate query targeting QUEUED scans with nextRunAt <= now', async () => {
      const origFindOneAndUpdate = Scan.findOneAndUpdate;
      let capturedFilter = null;
      let capturedUpdate = null;
      let capturedOptions = null;

      const dummyScan = {
        _id: new mongoose.Types.ObjectId(),
        status: 'RUNNING',
        attempts: 1,
        lockedBy: 'worker-unit-test:123',
      };

      Scan.findOneAndUpdate = jest.fn().mockImplementation((filter, update, options) => {
        capturedFilter = filter;
        capturedUpdate = update;
        capturedOptions = options;
        return Promise.resolve(dummyScan);
      });

      try {
        const result = await claimNextJob('worker-unit-test:123');

        expect(result).toBe(dummyScan);
        expect(capturedFilter.status).toBe('QUEUED');
        expect(capturedFilter.nextRunAt).toBeDefined();
        expect(capturedFilter.nextRunAt.$lte).toBeInstanceOf(Date);

        expect(capturedUpdate.$set.status).toBe('RUNNING');
        expect(capturedUpdate.$set.lockedBy).toBe('worker-unit-test:123');
        expect(capturedUpdate.$set.startedAt).toBeInstanceOf(Date);
        expect(capturedUpdate.$set.lockedAt).toBeInstanceOf(Date);
        expect(capturedUpdate.$set.leaseExpiresAt).toBeInstanceOf(Date);
        expect(capturedUpdate.$inc.attempts).toBe(1);

        expect(capturedOptions.sort).toEqual({ priority: -1, createdAt: 1 });
        expect(capturedOptions.returnDocument).toBe('after');
      } finally {
        Scan.findOneAndUpdate = origFindOneAndUpdate;
      }
    });

    test('returns null when no QUEUED scans are eligible', async () => {
      const origFindOneAndUpdate = Scan.findOneAndUpdate;
      Scan.findOneAndUpdate = jest.fn().mockResolvedValue(null);

      try {
        const result = await claimNextJob('worker-unit-test:123');
        expect(result).toBeNull();
      } finally {
        Scan.findOneAndUpdate = origFindOneAndUpdate;
      }
    });

    test('propagates database error cleanly during claim', async () => {
      const origFindOneAndUpdate = Scan.findOneAndUpdate;
      Scan.findOneAndUpdate = jest.fn().mockRejectedValue(new Error('MongoNetworkTimeout'));

      try {
        await expect(claimNextJob('worker-unit-test:123')).rejects.toThrow('MongoNetworkTimeout');
      } finally {
        Scan.findOneAndUpdate = origFindOneAndUpdate;
      }
    });
  });

  describe('renewLease Specifications (Phase 7B.2C)', () => {
    test('atomically updates leaseExpiresAt for RUNNING scan owned by worker', async () => {
      const origFindOneAndUpdate = Scan.findOneAndUpdate;
      const scanId = new mongoose.Types.ObjectId();
      let capturedFilter = null;
      let capturedUpdate = null;

      Scan.findOneAndUpdate = jest.fn().mockImplementation((filter, update) => {
        capturedFilter = filter;
        capturedUpdate = update;
        return Promise.resolve({ _id: scanId, status: 'RUNNING', lockedBy: 'worker-a' });
      });

      try {
        const result = await renewLease(scanId, 'worker-a', 60000);
        expect(result).not.toBeNull();
        expect(capturedFilter._id).toBe(scanId);
        expect(capturedFilter.status).toBe('RUNNING');
        expect(capturedFilter.lockedBy).toBe('worker-a');
        expect(capturedUpdate.$set.leaseExpiresAt).toBeInstanceOf(Date);
      } finally {
        Scan.findOneAndUpdate = origFindOneAndUpdate;
      }
    });

    test('returns null if scanId is invalid or workerId is missing', async () => {
      expect(await renewLease('invalid-id', 'worker-a')).toBeNull();
      expect(await renewLease(new mongoose.Types.ObjectId(), '')).toBeNull();
    });

    test('returns null if scan is no longer RUNNING or owned by another worker', async () => {
      const origFindOneAndUpdate = Scan.findOneAndUpdate;
      Scan.findOneAndUpdate = jest.fn().mockResolvedValue(null);

      try {
        const result = await renewLease(new mongoose.Types.ObjectId(), 'worker-a');
        expect(result).toBeNull();
      } finally {
        Scan.findOneAndUpdate = origFindOneAndUpdate;
      }
    });
  });

  describe('startHeartbeat Specifications (Phase 7B.2C)', () => {
    test('heartbeat handle provides stop() and prevents overlapping updates', async () => {
      jest.useFakeTimers();
      const origFindOneAndUpdate = Scan.findOneAndUpdate;
      const scanId = new mongoose.Types.ObjectId();

      let renewCalls = 0;
      Scan.findOneAndUpdate = jest.fn().mockImplementation(() => {
        renewCalls++;
        return Promise.resolve({ _id: scanId, status: 'RUNNING', lockedBy: 'worker-hb' });
      });

      try {
        const hb = startHeartbeat(scanId, 'worker-hb', {
          intervalMs: 1000,
          leaseDurationMs: 5000,
        });

        expect(hb.isActive()).toBe(true);

        // Advance timer by 1000ms -> 1st heartbeat
        await jest.advanceTimersByTimeAsync(1000);
        expect(renewCalls).toBe(1);

        // Advance timer by 1000ms -> 2nd heartbeat
        await jest.advanceTimersByTimeAsync(1000);
        expect(renewCalls).toBe(2);

        hb.stop();
        expect(hb.isActive()).toBe(false);

        // Advance timer again -> no more heartbeats
        await jest.advanceTimersByTimeAsync(2000);
        expect(renewCalls).toBe(2);
      } finally {
        jest.useRealTimers();
        Scan.findOneAndUpdate = origFindOneAndUpdate;
      }
    });

    test('invokes onLeaseLost callback when renewal returns null', async () => {
      jest.useFakeTimers();
      const origFindOneAndUpdate = Scan.findOneAndUpdate;
      const scanId = new mongoose.Types.ObjectId();

      Scan.findOneAndUpdate = jest.fn().mockResolvedValue(null); // Lease lost!
      const onLeaseLostMock = jest.fn();

      try {
        const hb = startHeartbeat(scanId, 'worker-lost', {
          intervalMs: 500,
          leaseDurationMs: 5000,
          onLeaseLost: onLeaseLostMock,
        });

        await jest.advanceTimersByTimeAsync(500);

        expect(onLeaseLostMock).toHaveBeenCalledWith(scanId);
        expect(hb.isActive()).toBe(false);
      } finally {
        jest.useRealTimers();
        Scan.findOneAndUpdate = origFindOneAndUpdate;
      }
    });
  });

  describe('reclaimSingleScan & reclaimStalledScans Specifications (Phase 7B.2C)', () => {
    test('reclaimSingleScan resets status to QUEUED and preserves activeScanKey', async () => {
      const origFindOneAndUpdate = Scan.findOneAndUpdate;
      const scanId = new mongoose.Types.ObjectId();
      let capturedFilter = null;
      let capturedUpdate = null;

      Scan.findOneAndUpdate = jest.fn().mockImplementation((filter, update) => {
        capturedFilter = filter;
        capturedUpdate = update;
        return Promise.resolve({ _id: scanId, status: 'QUEUED' });
      });

      try {
        const candidate = {
          _id: scanId,
          status: 'RUNNING',
          lockedBy: 'stale-worker:999',
          leaseExpiresAt: new Date(Date.now() - 10000),
        };

        const result = await reclaimSingleScan(candidate, new Date());
        expect(result).not.toBeNull();
        expect(capturedFilter.status).toBe('RUNNING');
        expect(capturedFilter.lockedBy).toBe('stale-worker:999');

        expect(capturedUpdate.$set.status).toBe('QUEUED');
        expect(capturedUpdate.$set.lockedBy).toBeNull();
        expect(capturedUpdate.$set.leaseExpiresAt).toBeNull();
        // activeScanKey must NOT be set to null so reservation is kept
        expect(capturedUpdate.$set.activeScanKey).toBeUndefined();
      } finally {
        Scan.findOneAndUpdate = origFindOneAndUpdate;
      }
    });

    test('reclaimStalledScans finds expired leases and requeues them', async () => {
      const origFind = Scan.find;
      const origFindOneAndUpdate = Scan.findOneAndUpdate;

      const scan1 = { _id: new mongoose.Types.ObjectId(), status: 'RUNNING', lockedBy: 'worker-1' };
      const scan2 = { _id: new mongoose.Types.ObjectId(), status: 'RUNNING', lockedBy: 'worker-2' };

      Scan.find = jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([scan1, scan2]),
        }),
      });

      Scan.findOneAndUpdate = jest.fn().mockImplementation((filter) => {
        return Promise.resolve({ _id: filter._id, status: 'QUEUED' });
      });

      try {
        const reclaimed = await reclaimStalledScans();
        expect(reclaimed.length).toBe(2);
      } finally {
        Scan.find = origFind;
        Scan.findOneAndUpdate = origFindOneAndUpdate;
      }
    });
  });

  describe('Worker Instance Lifecycle & Concurrency', () => {
    test('initializes with default or custom options and returns initial status', () => {
      const worker = createWorker({
        workerId: 'custom-worker-id',
        concurrency: 4,
        pollIntervalMs: 500,
      });

      const status = worker.getStatus();
      expect(status.workerId).toBe('custom-worker-id');
      expect(status.concurrency).toBe(4);
      expect(status.activeJobs).toBe(0);
      expect(status.running).toBe(false);
      expect(status.stopping).toBe(false);
    });

    test('start() sets running state and stop() shuts down gracefully', async () => {
      const worker = createWorker({
        workerId: 'lifecycle-test-worker',
        concurrency: 2,
        pollIntervalMs: 10000,
      });

      const origFindOneAndUpdate = Scan.findOneAndUpdate;
      Scan.findOneAndUpdate = jest.fn().mockResolvedValue(null);

      try {
        worker.start();
        expect(worker.getStatus().running).toBe(true);

        await worker.stop();
        expect(worker.getStatus().running).toBe(false);
        expect(worker.getStatus().stopping).toBe(true);
      } finally {
        Scan.findOneAndUpdate = origFindOneAndUpdate;
      }
    });

    test('tick claims jobs up to concurrency limit and does not exceed it', async () => {
      const worker = createWorker({
        workerId: 'concurrency-test-worker',
        concurrency: 2,
        pollIntervalMs: 10000,
      });

      const origFindOneAndUpdate = Scan.findOneAndUpdate;
      const origExecuteScan = scanExecutionService.executeScan;

      let claimCalls = 0;
      let resolveJob1, resolveJob2;
      const job1Promise = new Promise((resolve) => { resolveJob1 = resolve; });
      const job2Promise = new Promise((resolve) => { resolveJob2 = resolve; });

      Scan.findOneAndUpdate = jest.fn().mockImplementation(() => {
        claimCalls++;
        return Promise.resolve({
          _id: new mongoose.Types.ObjectId(),
          status: 'RUNNING',
        });
      });

      scanExecutionService.executeScan = jest.fn().mockImplementation((scanId) => {
        if (claimCalls === 1) return job1Promise;
        if (claimCalls === 2) return job2Promise;
        return Promise.resolve();
      });

      try {
        worker.start();
        await new Promise((r) => setTimeout(r, 50));

        expect(claimCalls).toBe(2);
        expect(worker.getStatus().activeJobs).toBe(2);

        resolveJob1();
        resolveJob2();

        await new Promise((r) => setTimeout(r, 50));
        await worker.stop();
      } finally {
        Scan.findOneAndUpdate = origFindOneAndUpdate;
        scanExecutionService.executeScan = origExecuteScan;
      }
    });
  });
});
