/**
 * Integration Tests: Scan Worker Subsystem & Atomic Job Claiming (Phase 7B.2B)
 *
 * Runs against the isolated test database 'codeatlas_test' using real MongoDB queries.
 * Validates:
 * - Simultaneous atomic claims by two workers on a single scan
 * - Priority-based claim ordering
 * - FIFO arrival ordering for equal priorities
 * - Future nextRunAt scheduled scans are excluded
 * - Configurable concurrency enforcement (max concurrency = 2)
 * - Safe graceful shutdown with in-flight jobs
 * - End-to-end execution integration via worker
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
const Repository = require('../../src/models/Repository');
const AnalysisResult = require('../../src/models/AnalysisResult');
const scanExecutionService = require('../../src/services/scanExecutionService');
const analyzerService = require('../../src/services/analyzerService');
const { connectTestDb, cleanTestDb, disconnectTestDb } = require('../helpers/testDb');
const { createAuthenticatedUser } = require('../helpers/authHelper');
const { sampleAnalyzerOutput } = require('../fixtures/analyzerOutput.fixture');

describe('Scan Worker Integration Tests (Phase 7B.2B)', () => {
  let user;
  let repo;

  beforeAll(async () => {
    await connectTestDb();
  });

  afterAll(async () => {
    await cleanTestDb();
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await cleanTestDb();

    const auth = await createAuthenticatedUser({ name: 'Worker User', email: 'worker-test@codeatlas.test' });
    user = auth.user;

    repo = await Repository.create({
      userId: user._id,
      githubRepositoryId: '98765432',
      name: 'worker-repo',
      owner: 'workertest',
      fullName: 'workertest/worker-repo',
      htmlUrl: 'https://github.com/workertest/worker-repo',
      defaultBranch: 'main',
    });
  });

  describe('Atomic Simultaneous Claims with Real MongoDB', () => {
    test('when two workers claim concurrently, exactly one receives the scan and the other receives null', async () => {
      // 1. Create exactly one QUEUED scan
      const scan = await Scan.create({
        repositoryId: repo._id,
        userId: user._id,
        status: 'QUEUED',
        branch: 'main',
        commitSha: 'commit12345',
        activeScanKey: repo._id.toString(),
        priority: 0,
        attempts: 0,
        nextRunAt: new Date(),
      });

      const workerA = generateWorkerId();
      const workerB = generateWorkerId();

      // 2. Trigger concurrent claims from two independent worker IDs
      const [claimA, claimB] = await Promise.all([
        claimNextJob(workerA),
        claimNextJob(workerB),
      ]);

      // Exactly one worker must succeed, the other must receive null
      const successfulWorker = claimA ? workerA : workerB;
      const successfulClaim = claimA || claimB;
      const failedClaim = claimA ? claimB : claimA;

      expect(successfulClaim).not.toBeNull();
      expect(failedClaim).toBeNull();
      expect(successfulClaim._id.toString()).toBe(scan._id.toString());
      expect(successfulClaim.status).toBe('RUNNING');
      expect(successfulClaim.attempts).toBe(1);
      expect(successfulClaim.lockedBy).toBe(successfulWorker);
      expect(successfulClaim.lockedAt).toBeInstanceOf(Date);
      expect(successfulClaim.leaseExpiresAt).toBeInstanceOf(Date);

      // Verify the document state in MongoDB
      const dbScan = await Scan.findById(scan._id);
      expect(dbScan.status).toBe('RUNNING');
      expect(dbScan.attempts).toBe(1);
      expect(dbScan.lockedBy).toBe(successfulWorker);
    });
  });

  describe('Job Selection Ordering: Priority & Arrival Time', () => {
    test('claims higher priority jobs before lower priority jobs', async () => {
      const now = new Date();

      // Insert scans with priorities: 0, 10, 5
      const scanLow = await Scan.create({
        repositoryId: repo._id,
        userId: user._id,
        status: 'QUEUED',
        branch: 'main',
        priority: 0,
        nextRunAt: now,
      });

      const scanHigh = await Scan.create({
        repositoryId: repo._id,
        userId: user._id,
        status: 'QUEUED',
        branch: 'main',
        priority: 10,
        nextRunAt: now,
      });

      const scanMedium = await Scan.create({
        repositoryId: repo._id,
        userId: user._id,
        status: 'QUEUED',
        branch: 'main',
        priority: 5,
        nextRunAt: now,
      });

      const workerId = generateWorkerId();

      const firstClaim = await claimNextJob(workerId);
      expect(firstClaim._id.toString()).toBe(scanHigh._id.toString());
      expect(firstClaim.priority).toBe(10);

      const secondClaim = await claimNextJob(workerId);
      expect(secondClaim._id.toString()).toBe(scanMedium._id.toString());
      expect(secondClaim.priority).toBe(5);

      const thirdClaim = await claimNextJob(workerId);
      expect(thirdClaim._id.toString()).toBe(scanLow._id.toString());
      expect(thirdClaim.priority).toBe(0);

      const fourthClaim = await claimNextJob(workerId);
      expect(fourthClaim).toBeNull();
    });

    test('claims older scans first when priorities are equal (FIFO)', async () => {
      const earlierDate = new Date(Date.now() - 5000);
      const laterDate = new Date(Date.now() - 1000);

      const scanFirst = await Scan.create({
        repositoryId: repo._id,
        userId: user._id,
        status: 'QUEUED',
        branch: 'main',
        priority: 0,
        createdAt: earlierDate,
        nextRunAt: earlierDate,
      });

      const scanSecond = await Scan.create({
        repositoryId: repo._id,
        userId: user._id,
        status: 'QUEUED',
        branch: 'main',
        priority: 0,
        createdAt: laterDate,
        nextRunAt: laterDate,
      });

      const workerId = generateWorkerId();

      const claim1 = await claimNextJob(workerId);
      expect(claim1._id.toString()).toBe(scanFirst._id.toString());

      const claim2 = await claimNextJob(workerId);
      expect(claim2._id.toString()).toBe(scanSecond._id.toString());
    });

    test('does not claim scans scheduled for the future (nextRunAt > now)', async () => {
      const futureDate = new Date(Date.now() + 60 * 1000); // 1 minute in future

      await Scan.create({
        repositoryId: repo._id,
        userId: user._id,
        status: 'QUEUED',
        branch: 'main',
        priority: 0,
        nextRunAt: futureDate,
      });

      const workerId = generateWorkerId();
      const claim = await claimNextJob(workerId);
      expect(claim).toBeNull();
    });
  });

  describe('Worker Concurrency & Lifecycle Enforcement', () => {
    test('worker strictly respects configured concurrency limit of 2', async () => {
      // Create 4 queued scans
      const now = new Date();
      for (let i = 0; i < 4; i++) {
        await Scan.create({
          repositoryId: repo._id,
          userId: user._id,
          status: 'QUEUED',
          branch: `branch-${i}`,
          priority: i,
          nextRunAt: now,
        });
      }

      const worker = createWorker({
        concurrency: 2,
        pollIntervalMs: 50,
      });

      let resolveExecution;
      const executionWaitPromise = new Promise((resolve) => {
        resolveExecution = resolve;
      });

      const origExecute = scanExecutionService.executeScan;
      scanExecutionService.executeScan = jest.fn().mockImplementation(() => executionWaitPromise);

      try {
        worker.start();
        // Wait for first tick to claim jobs
        await new Promise((r) => setTimeout(r, 100));

        const status = worker.getStatus();
        expect(status.activeJobs).toBe(2);

        // Check MongoDB: exactly 2 scans RUNNING, 2 scans still QUEUED
        const runningCount = await Scan.countDocuments({ status: 'RUNNING' });
        const queuedCount = await Scan.countDocuments({ status: 'QUEUED' });
        expect(runningCount).toBe(2);
        expect(queuedCount).toBe(2);

        // Release executions
        resolveExecution();
        await new Promise((r) => setTimeout(r, 100));
        await worker.stop();
      } finally {
        scanExecutionService.executeScan = origExecute;
      }
    });

    test('graceful shutdown waits for in-flight scan execution before resolving', async () => {
      const scan = await Scan.create({
        repositoryId: repo._id,
        userId: user._id,
        status: 'QUEUED',
        branch: 'main',
        nextRunAt: new Date(),
      });

      const worker = createWorker({
        concurrency: 1,
        pollIntervalMs: 50,
        shutdownTimeoutMs: 5000,
      });

      let jobFinished = false;
      const origExecute = scanExecutionService.executeScan;
      scanExecutionService.executeScan = jest.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 100));
        jobFinished = true;
      });

      try {
        worker.start();
        await new Promise((r) => setTimeout(r, 30));

        // Stop while job is in-flight
        expect(worker.getStatus().activeJobs).toBe(1);
        await worker.stop();

        // Must have waited until job finished
        expect(jobFinished).toBe(true);
        expect(worker.getStatus().activeJobs).toBe(0);
        expect(worker.getStatus().stopping).toBe(true);
      } finally {
        scanExecutionService.executeScan = origExecute;
      }
    });
  });

  describe('End-to-End Execution Integration Via Worker', () => {
    test('worker claims and executes scan to COMPLETED, creates AnalysisResult, and releases locks', async () => {
      const scan = await Scan.create({
        repositoryId: repo._id,
        userId: user._id,
        status: 'QUEUED',
        branch: 'main',
        commitSha: 'sha-worker-e2e',
        activeScanKey: repo._id.toString(),
        nextRunAt: new Date(),
      });

      // Mock analyzerService to return valid results
      const origAnalyze = analyzerService.analyze;
      analyzerService.analyze = jest.fn().mockResolvedValue(sampleAnalyzerOutput);

      const worker = createWorker({
        concurrency: 1,
        pollIntervalMs: 50,
      });

      try {
        worker.start();

        // Wait for scan to complete in DB
        let completedScan = null;
        for (let i = 0; i < 20; i++) {
          const s = await Scan.findById(scan._id);
          if (s && s.status === 'COMPLETED') {
            completedScan = s;
            break;
          }
          await new Promise((r) => setTimeout(r, 100));
        }

        expect(completedScan).not.toBeNull();
        expect(completedScan.status).toBe('COMPLETED');
        expect(completedScan.filesScanned).toBe(sampleAnalyzerOutput.statistics.totalFiles);
        expect(completedScan.findingsCount).toBe(sampleAnalyzerOutput.drift.summary.total);
        expect(completedScan.activeScanKey).toBeNull();
        expect(completedScan.lockedBy).toBeNull();
        expect(completedScan.leaseExpiresAt).toBeNull();

        // Verify AnalysisResult was created
        const result = await AnalysisResult.findOne({ scanId: scan._id });
        expect(result).not.toBeNull();
        expect(result.repositoryId.toString()).toBe(repo._id.toString());
        expect(result.commitSha).toBe('sha-worker-e2e');

        await worker.stop();
      } finally {
        analyzerService.analyze = origAnalyze;
      }
    });
  });

  describe('Heartbeat, Lease Management & Crash Recovery Integration Tests (Phase 7B.2C)', () => {
    test('1. heartbeat successfully extends a lease', async () => {
      const initialLease = new Date(Date.now() + 5000);
      const scan = await Scan.create({
        repositoryId: repo._id,
        userId: user._id,
        status: 'RUNNING',
        branch: 'main',
        lockedBy: 'worker-lease-owner',
        lockedAt: new Date(),
        leaseExpiresAt: initialLease,
      });

      const renewed = await renewLease(scan._id, 'worker-lease-owner', 60000);
      expect(renewed).not.toBeNull();
      expect(renewed.leaseExpiresAt.getTime()).toBeGreaterThan(initialLease.getTime());

      const dbScan = await Scan.findById(scan._id);
      expect(dbScan.leaseExpiresAt.getTime()).toBe(renewed.leaseExpiresAt.getTime());
    });

    test("2. heartbeat cannot extend another worker's lease", async () => {
      const initialLease = new Date(Date.now() + 5000);
      const scan = await Scan.create({
        repositoryId: repo._id,
        userId: user._id,
        status: 'RUNNING',
        branch: 'main',
        lockedBy: 'worker-real-owner',
        lockedAt: new Date(),
        leaseExpiresAt: initialLease,
      });

      const renewed = await renewLease(scan._id, 'worker-imposter', 60000);
      expect(renewed).toBeNull();

      const dbScan = await Scan.findById(scan._id);
      expect(dbScan.leaseExpiresAt.getTime()).toBe(initialLease.getTime());
      expect(dbScan.lockedBy).toBe('worker-real-owner');
    });

    test('3. heartbeat stops after job completion', async () => {
      const scan = await Scan.create({
        repositoryId: repo._id,
        userId: user._id,
        status: 'RUNNING',
        branch: 'main',
        lockedBy: 'worker-hb-stop',
        lockedAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + 2000),
      });

      const hb = startHeartbeat(scan._id, 'worker-hb-stop', {
        intervalMs: 30,
        leaseDurationMs: 1000,
      });

      // Allow 2 heartbeat ticks to run
      await new Promise((r) => setTimeout(r, 80));

      // Stop heartbeat and ensure any in-flight renewal finishes
      await hb.stop();
      expect(hb.isActive()).toBe(false);

      const midScan = await Scan.findById(scan._id);
      const midLeaseTime = midScan.leaseExpiresAt.getTime();

      // Wait further and verify lease is no longer extended
      await new Promise((r) => setTimeout(r, 80));
      const finalScan = await Scan.findById(scan._id);
      expect(finalScan.leaseExpiresAt.getTime()).toBe(midLeaseTime);
    });

    test('4. expired lease is detected', async () => {
      const pastDate = new Date(Date.now() - 10000);
      const scan = await Scan.create({
        repositoryId: repo._id,
        userId: user._id,
        status: 'RUNNING',
        branch: 'main',
        lockedBy: 'worker-stale-1',
        lockedAt: pastDate,
        leaseExpiresAt: pastDate,
      });

      const reclaimed = await reclaimStalledScans();
      expect(reclaimed.length).toBeGreaterThanOrEqual(1);
      const found = reclaimed.find((s) => s._id.toString() === scan._id.toString());
      expect(found).toBeDefined();
    });

    test('5. expired lease is safely requeued', async () => {
      const pastDate = new Date(Date.now() - 15000);
      const scan = await Scan.create({
        repositoryId: repo._id,
        userId: user._id,
        status: 'RUNNING',
        branch: 'main',
        lockedBy: 'worker-stale-2',
        lockedAt: pastDate,
        leaseExpiresAt: pastDate,
        activeScanKey: repo._id.toString(),
      });

      await reclaimStalledScans();

      const dbScan = await Scan.findById(scan._id);
      expect(dbScan.status).toBe('QUEUED');
      expect(dbScan.lockedBy).toBeNull();
      expect(dbScan.lockedAt).toBeNull();
      expect(dbScan.leaseExpiresAt).toBeNull();
      // activeScanKey must be preserved so repo remains reserved!
      expect(dbScan.activeScanKey).toBe(repo._id.toString());
      expect(dbScan.lastError).toContain('Lease expired');
      expect(dbScan.nextRunAt.getTime()).toBeLessThanOrEqual(Date.now());
    });

    test('6. valid lease is not reclaimed', async () => {
      const futureDate = new Date(Date.now() + 60000);
      const scan = await Scan.create({
        repositoryId: repo._id,
        userId: user._id,
        status: 'RUNNING',
        branch: 'main',
        lockedBy: 'worker-active-valid',
        lockedAt: new Date(),
        leaseExpiresAt: futureDate,
      });

      const reclaimed = await reclaimStalledScans();
      const found = reclaimed.find((s) => s._id.toString() === scan._id.toString());
      expect(found).toBeUndefined();

      const dbScan = await Scan.findById(scan._id);
      expect(dbScan.status).toBe('RUNNING');
      expect(dbScan.lockedBy).toBe('worker-active-valid');
      expect(dbScan.leaseExpiresAt.getTime()).toBe(futureDate.getTime());
    });

    test('7. two recovery processes cannot reclaim the same job twice', async () => {
      const pastDate = new Date(Date.now() - 10000);
      const scan = await Scan.create({
        repositoryId: repo._id,
        userId: user._id,
        status: 'RUNNING',
        branch: 'main',
        lockedBy: 'worker-race-stale',
        lockedAt: pastDate,
        leaseExpiresAt: pastDate,
      });

      const [reclaimedA, reclaimedB] = await Promise.all([
        reclaimStalledScans(),
        reclaimStalledScans(),
      ]);

      const foundA = reclaimedA.filter((s) => s._id.toString() === scan._id.toString());
      const foundB = reclaimedB.filter((s) => s._id.toString() === scan._id.toString());

      // Across both concurrent sweeps, exactly one recovered this scan
      expect(foundA.length + foundB.length).toBe(1);
    });

    test('8. recovered jobs can be claimed by another worker', async () => {
      const pastDate = new Date(Date.now() - 10000);
      const scan = await Scan.create({
        repositoryId: repo._id,
        userId: user._id,
        status: 'RUNNING',
        branch: 'main',
        lockedBy: 'worker-crashed',
        lockedAt: pastDate,
        leaseExpiresAt: pastDate,
        activeScanKey: repo._id.toString(),
        attempts: 1,
      });

      // Reclaim the expired scan
      await reclaimStalledScans();

      // New worker claims it
      const newWorkerId = generateWorkerId();
      const claimed = await claimNextJob(newWorkerId);

      expect(claimed).not.toBeNull();
      expect(claimed._id.toString()).toBe(scan._id.toString());
      expect(claimed.status).toBe('RUNNING');
      expect(claimed.lockedBy).toBe(newWorkerId);
      expect(claimed.attempts).toBe(2);
    });

    test('9. terminal scans are never requeued', async () => {
      const pastDate = new Date(Date.now() - 10000);

      const completedScan = await Scan.create({
        repositoryId: repo._id,
        userId: user._id,
        status: 'COMPLETED',
        branch: 'main',
        lockedBy: 'worker-old',
        leaseExpiresAt: pastDate,
        completedAt: pastDate,
      });

      const failedScan = await Scan.create({
        repositoryId: repo._id,
        userId: user._id,
        status: 'FAILED',
        branch: 'main',
        lockedBy: 'worker-old',
        leaseExpiresAt: pastDate,
        completedAt: pastDate,
        error: 'Failed earlier',
      });

      const reclaimed = await reclaimStalledScans();
      expect(reclaimed.find((s) => s._id.toString() === completedScan._id.toString())).toBeUndefined();
      expect(reclaimed.find((s) => s._id.toString() === failedScan._id.toString())).toBeUndefined();

      const dbCompleted = await Scan.findById(completedScan._id);
      expect(dbCompleted.status).toBe('COMPLETED');

      const dbFailed = await Scan.findById(failedScan._id);
      expect(dbFailed.status).toBe('FAILED');
    });

    test('10. missing scan records are handled safely', async () => {
      const nonExistentId = new mongoose.Types.ObjectId();
      const renewResult = await renewLease(nonExistentId, 'worker-any');
      expect(renewResult).toBeNull();

      const dummyCandidate = { _id: nonExistentId, lockedBy: 'ghost-worker' };
      const reclaimResult = await reclaimSingleScan(dummyCandidate);
      expect(reclaimResult).toBeNull();
    });

    test('11. worker shutdown preserves recoverability', async () => {
      const scan = await Scan.create({
        repositoryId: repo._id,
        userId: user._id,
        status: 'QUEUED',
        branch: 'main',
        nextRunAt: new Date(),
        activeScanKey: repo._id.toString(),
      });

      const worker = createWorker({
        concurrency: 1,
        pollIntervalMs: 20,
        shutdownTimeoutMs: 50, // Short shutdown timeout
      });

      let resolveJob;
      const longJobPromise = new Promise((resolve) => {
        resolveJob = resolve;
      });

      const origExecute = scanExecutionService.executeScan;
      scanExecutionService.executeScan = jest.fn().mockImplementation(() => longJobPromise);

      try {
        worker.start();
        await new Promise((r) => setTimeout(r, 40));

        // Worker claimed the scan
        const runningScan = await Scan.findById(scan._id);
        expect(runningScan.status).toBe('RUNNING');

        // Stop worker while job is unresolved
        await worker.stop();

        // After shutdown timeout elapsed, scan MUST remain intact as RUNNING (not falsely COMPLETED)
        const postStopScan = await Scan.findById(scan._id);
        expect(postStopScan.status).toBe('RUNNING');
        expect(postStopScan.activeScanKey).toBe(repo._id.toString());

        // When its lease is expired in the future, it can be recovered
        postStopScan.leaseExpiresAt = new Date(Date.now() - 5000);
        await postStopScan.save();

        const recovered = await reclaimStalledScans();
        expect(recovered.find((s) => s._id.toString() === scan._id.toString())).toBeDefined();

        resolveJob();
      } finally {
        scanExecutionService.executeScan = origExecute;
      }
    });

    test('12. long-running scans survive multiple heartbeat intervals', async () => {
      const scan = await Scan.create({
        repositoryId: repo._id,
        userId: user._id,
        status: 'QUEUED',
        branch: 'main',
        commitSha: 'sha-long-running',
        activeScanKey: repo._id.toString(),
        nextRunAt: new Date(),
      });

      const origAnalyze = analyzerService.analyze;
      // Analyzer simulates work taking 150ms
      analyzerService.analyze = jest.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 150));
        return sampleAnalyzerOutput;
      });

      // Worker configured with initial lease of 80ms, but heartbeats every 30ms extending lease by 80ms
      const worker = createWorker({
        concurrency: 1,
        pollIntervalMs: 20,
        heartbeatIntervalMs: 30,
        leaseDurationMs: 80,
      });

      try {
        worker.start();

        // Wait for scan completion (takes ~150ms)
        let completed = null;
        for (let i = 0; i < 25; i++) {
          const s = await Scan.findById(scan._id);
          if (s && s.status === 'COMPLETED') {
            completed = s;
            break;
          }
          await new Promise((r) => setTimeout(r, 20));
        }

        expect(completed).not.toBeNull();
        expect(completed.status).toBe('COMPLETED');
        expect(completed.activeScanKey).toBeNull();

        await worker.stop();
      } finally {
        analyzerService.analyze = origAnalyze;
      }
    });
  });
});

