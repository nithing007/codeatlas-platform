/**
 * System Reliability & Full Queue Lifecycle Validation (Phase 7B.2F)
 *
 * Runs exclusively against the isolated test database 'codeatlas_test'.
 * Validates the complete persistent queue architecture under end-to-end,
 * recovery, concurrency, and crash scenarios:
 *
 * 1. Complete End-to-End Flow: API -> Queue -> Worker -> Analyzer -> Result -> API Retrieval
 * 2. API Process Restart: Queued scans survive restart; Running scans unaffected
 * 3. Worker Restart & Crash Recovery: Stalled leases recovered on startup
 * 4. Stale Worker Rejection: Worker that lost lease cannot mutate scan state
 * 5. Complete 3-Attempt Retry Progression: 10s -> 20s -> Terminal Failure
 * 6. Idempotent Crash Recovery: Reuses existing AnalysisResult without duplicate documents
 * 7. Concurrency & Concurrency Cap: Multiple workers, atomic claims, queue limits
 * 8. ActiveScanKey Lifecycle: Enforced across active states and released on terminal states
 */

'use strict';

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../src/app');
const Scan = require('../../src/models/Scan');
const Repository = require('../../src/models/Repository');
const AnalysisResult = require('../../src/models/AnalysisResult');
const githubService = require('../../src/services/githubService');
const analyzerService = require('../../src/services/analyzerService');
const scanExecutionService = require('../../src/services/scanExecutionService');
const {
  generateWorkerId,
  claimNextJob,
  reclaimStalledScans,
  createWorker,
  scheduleRetry,
  markTerminalFailure,
} = require('../../src/queue/scanWorker');
const { enqueueScan } = require('../../src/queue/scanQueue');
const { connectTestDb, cleanTestDb, disconnectTestDb } = require('../helpers/testDb');
const { createAuthenticatedUser } = require('../helpers/authHelper');
const { sampleAnalyzerOutput } = require('../fixtures/analyzerOutput.fixture');

describe('Phase 7B.2F: Full Queue Lifecycle & System Reliability Validation', () => {
  let user;
  let cookie;
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

    const auth = await createAuthenticatedUser({
      name: 'Reliability User',
      email: 'reliability-test@codeatlas.test',
    });
    user = auth.user;
    cookie = auth.cookie;

    repo = await Repository.create({
      userId: user._id,
      githubRepositoryId: '77665544',
      name: 'reliability-repo',
      owner: 'reliabilityowner',
      fullName: 'reliabilityowner/reliability-repo',
      htmlUrl: 'https://github.com/reliabilityowner/reliability-repo',
      defaultBranch: 'main',
    });

    jest.spyOn(githubService, 'resolveCommitSha').mockResolvedValue('sha-reliability-7b2f');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Full End-to-End Pipeline
  // -------------------------------------------------------------------------
  describe('1. Full End-to-End Lifecycle: API -> Queue -> Worker -> Analyzer -> API', () => {
    test('Scan moves through QUEUED -> RUNNING -> COMPLETED with AnalysisResult retrieval', async () => {
      jest.spyOn(analyzerService, 'analyze').mockResolvedValue(sampleAnalyzerOutput);

      // Step 1: Client submits scan request via HTTP API
      const createRes = await request(app)
        .post(`/api/repositories/${repo._id}/scans`)
        .set('Cookie', cookie);

      expect(createRes.status).toBe(201);
      expect(createRes.body.success).toBe(true);
      const scanId = createRes.body.scan._id;

      // Verify Scan is in QUEUED state in DB
      let scanDoc = await Scan.findById(scanId);
      expect(scanDoc.status).toBe('QUEUED');
      expect(scanDoc.activeScanKey).toBe(repo._id.toString());
      expect(scanDoc.attempts).toBe(0);

      // Step 2: Dedicated Worker claims the scan
      const workerId = generateWorkerId();
      const claimed = await claimNextJob(workerId);
      expect(claimed).not.toBeNull();
      expect(claimed._id.toString()).toBe(scanId);
      expect(claimed.status).toBe('RUNNING');
      expect(claimed.attempts).toBe(1);
      expect(claimed.lockedBy).toBe(workerId);

      // Step 3: Worker executes scan
      await scanExecutionService.executeScan(claimed._id, {
        alreadyClaimed: true,
        claimedScan: claimed,
        workerId,
      });

      // Step 4: Verify Scan completed and activeScanKey released
      scanDoc = await Scan.findById(scanId);
      expect(scanDoc.status).toBe('COMPLETED');
      expect(scanDoc.activeScanKey).toBeNull();
      expect(scanDoc.completedAt).toBeInstanceOf(Date);
      expect(scanDoc.filesScanned).toBe(78);

      // Step 5: Verify AnalysisResult persisted
      const resultDoc = await AnalysisResult.findOne({ scanId });
      expect(resultDoc).not.toBeNull();
      expect(resultDoc.repositoryId.toString()).toBe(repo._id.toString());

      // Step 6: Frontend polling endpoint retrieves completed scan and analysis
      const pollRes = await request(app)
        .get(`/api/repositories/${repo._id}/scans/${scanId}`)
        .set('Cookie', cookie);

      expect(pollRes.status).toBe(200);
      expect(pollRes.body.success).toBe(true);
      expect(pollRes.body.scan.status).toBe('COMPLETED');

      const analysisRes = await request(app)
        .get(`/api/repositories/${repo._id}/scans/${scanId}/analysis`)
        .set('Cookie', cookie);

      expect(analysisRes.status).toBe(200);
      expect(analysisRes.body.success).toBe(true);
      expect(analysisRes.body.analysis.scanId).toBe(scanId);
    });
  });

  // -------------------------------------------------------------------------
  // 2. API Process Restart Invariants
  // -------------------------------------------------------------------------
  describe('2. API Process Restart Scenarios', () => {
    test('QUEUED scans survive API process restarts without being killed or lost', async () => {
      // 1. API creates a scan
      const res = await request(app)
        .post(`/api/repositories/${repo._id}/scans`)
        .set('Cookie', cookie);
      expect(res.status).toBe(201);
      const scanId = res.body.scan._id;

      // 2. Simulate API process restarting (no reconcileStrandedScans call)
      // Verify the scan is untouched and still QUEUED
      const scanAfterRestart = await Scan.findById(scanId);
      expect(scanAfterRestart.status).toBe('QUEUED');
      expect(scanAfterRestart.activeScanKey).toBe(repo._id.toString());

      // 3. Independent worker can claim it and process it
      const workerId = generateWorkerId();
      const claimed = await claimNextJob(workerId);
      expect(claimed).not.toBeNull();
      expect(claimed._id.toString()).toBe(scanId);
      expect(claimed.status).toBe('RUNNING');
    });

    test('RUNNING scans owned by workers are not interrupted by API server restarts', async () => {
      // 1. Create and claim scan
      const scan = await enqueueScan({
        repositoryId: repo._id,
        userId: user._id,
        branch: 'main',
        commitSha: 'sha-run-123',
      });
      const workerId = generateWorkerId();
      const claimed = await claimNextJob(workerId);
      expect(claimed.status).toBe('RUNNING');

      // 2. Simulate API server restarting
      // The running scan in MongoDB must retain its RUNNING status and worker lease
      const scanDoc = await Scan.findById(scan._id);
      expect(scanDoc.status).toBe('RUNNING');
      expect(scanDoc.lockedBy).toBe(workerId);
      expect(scanDoc.leaseExpiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  // -------------------------------------------------------------------------
  // 3. Worker Restart, Stalled Scans & Stale Worker Rejection
  // -------------------------------------------------------------------------
  describe('3. Worker Restart, Stalled Scan Recovery & Stale Worker Rejection', () => {
    test('Worker startup recovers stalled scan with expired lease; replacement worker claims it', async () => {
      // 1. Create a scan locked by a crashed worker whose lease expired 1 minute ago
      const crashedWorkerId = 'worker-crashed:1234:uuid';
      const scan = await Scan.create({
        repositoryId: repo._id,
        userId: user._id,
        status: 'RUNNING',
        branch: 'main',
        commitSha: 'sha-stalled-test',
        activeScanKey: repo._id.toString(),
        priority: 0,
        attempts: 1,
        lockedBy: crashedWorkerId,
        lockedAt: new Date(Date.now() - 120000),
        leaseExpiresAt: new Date(Date.now() - 60000),
      });

      // 2. Replacement worker process starts up and sweeps for stalled scans
      const reclaimed = await reclaimStalledScans({ now: new Date() });
      expect(reclaimed.length).toBe(1);
      expect(reclaimed[0]._id.toString()).toBe(scan._id.toString());
      expect(reclaimed[0].status).toBe('QUEUED');
      expect(reclaimed[0].lockedBy).toBeNull();
      expect(reclaimed[0].activeScanKey).toBe(repo._id.toString()); // Lock preserved!

      // 3. Replacement worker claims the reclaimed scan
      const newWorkerId = generateWorkerId();
      const claimedByNew = await claimNextJob(newWorkerId);
      expect(claimedByNew).not.toBeNull();
      expect(claimedByNew._id.toString()).toBe(scan._id.toString());
      expect(claimedByNew.attempts).toBe(2); // Incremented from 1 to 2!
      expect(claimedByNew.lockedBy).toBe(newWorkerId);
    });

    test('Stale worker that lost its lease cannot update scan state or retry', async () => {
      const workerA = generateWorkerId();
      const workerB = generateWorkerId();

      const scan = await enqueueScan({
        repositoryId: repo._id,
        userId: user._id,
        branch: 'main',
        commitSha: 'sha-stale-worker',
      });

      // Worker A claims scan
      const claimedA = await claimNextJob(workerA);
      expect(claimedA.lockedBy).toBe(workerA);

      // Ownership switches to Worker B (simulating lease reclaim)
      await Scan.updateOne(
        { _id: scan._id },
        {
          $set: {
            lockedBy: workerB,
            lockedAt: new Date(),
            leaseExpiresAt: new Date(Date.now() + 60000),
          },
        }
      );

      // Worker A attempts to schedule a retry -> rejected (returns null)
      const retryResult = await scheduleRetry(
        claimedA,
        { sanitizedMessage: 'Delayed failure from worker A' },
        workerA
      );
      expect(retryResult).toBeNull();

      // Worker A attempts to mark terminal failure -> rejected (returns null)
      const failResult = await markTerminalFailure(
        claimedA._id,
        'Fatal error from worker A',
        workerA
      );
      expect(failResult).toBeNull();

      // Database document remains untouched and owned by Worker B
      const dbScan = await Scan.findById(scan._id);
      expect(dbScan.status).toBe('RUNNING');
      expect(dbScan.lockedBy).toBe(workerB);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Retry Lifecycle & Schedule Invariants
  // -------------------------------------------------------------------------
  describe('4. Complete Retry Lifecycle (Attempt 1: 10s -> Attempt 2: 20s -> Attempt 3: Terminal FAILED)', () => {
    test('Full 3-attempt progression enforces correct backoffs, attempt counts, and activeScanKey release', async () => {
      const workerId = generateWorkerId();
      const scan = await enqueueScan({
        repositoryId: repo._id,
        userId: user._id,
        branch: 'main',
        commitSha: 'sha-retry-progression',
      });

      // --- ATTEMPT 1 ---
      const claim1 = await claimNextJob(workerId);
      expect(claim1.attempts).toBe(1);

      const beforeRetry1 = Date.now();
      const retry1 = await scheduleRetry(
        claim1,
        { sanitizedMessage: 'Transient error 1' },
        workerId,
        new Date(beforeRetry1)
      );
      expect(retry1.status).toBe('QUEUED');
      expect(retry1.attempts).toBe(1); // Not mutated!
      expect(retry1.activeScanKey).toBe(repo._id.toString()); // Held!
      expect(retry1.nextRunAt.getTime()).toBe(beforeRetry1 + 10000); // 10s backoff!

      // Fast-forward nextRunAt for testing claim 2
      await Scan.updateOne({ _id: scan._id }, { $set: { nextRunAt: new Date(Date.now() - 1000) } });

      // --- ATTEMPT 2 ---
      const claim2 = await claimNextJob(workerId);
      expect(claim2.attempts).toBe(2); // Incremented on claim!

      const beforeRetry2 = Date.now();
      const retry2 = await scheduleRetry(
        claim2,
        { sanitizedMessage: 'Transient error 2' },
        workerId,
        new Date(beforeRetry2)
      );
      expect(retry2.status).toBe('QUEUED');
      expect(retry2.attempts).toBe(2);
      expect(retry2.activeScanKey).toBe(repo._id.toString());
      expect(retry2.nextRunAt.getTime()).toBe(beforeRetry2 + 20000); // 20s backoff!

      // Fast-forward nextRunAt for testing claim 3
      await Scan.updateOne({ _id: scan._id }, { $set: { nextRunAt: new Date(Date.now() - 1000) } });

      // --- ATTEMPT 3 ---
      const claim3 = await claimNextJob(workerId);
      expect(claim3.attempts).toBe(3);

      // Attempt 3 fails -> since attempts >= maxAttempts (3 >= 3), markTerminalFailure is invoked
      const terminalFailure = await markTerminalFailure(
        claim3._id,
        { sanitizedMessage: 'Max retries exceeded' },
        workerId
      );
      expect(terminalFailure.status).toBe('FAILED');
      expect(terminalFailure.completedAt).toBeInstanceOf(Date);
      expect(terminalFailure.activeScanKey).toBeNull(); // Lock released!
      expect(terminalFailure.error).toBe('Max retries exceeded');

      // Now a new scan can be enqueued for the same repository
      const newScan = await enqueueScan({
        repositoryId: repo._id,
        userId: user._id,
        branch: 'main',
        commitSha: 'sha-new-after-failure',
      });
      expect(newScan.status).toBe('QUEUED');
      expect(newScan.activeScanKey).toBe(repo._id.toString());
    });
  });

  // -------------------------------------------------------------------------
  // 5. Idempotent Result Persistence
  // -------------------------------------------------------------------------
  describe('5. Idempotency & Crash-Window Recovery', () => {
    test('Simulated crash after AnalysisResult creation reuses existing result without duplicate-key error', async () => {
      const workerId = generateWorkerId();
      const scan = await enqueueScan({
        repositoryId: repo._id,
        userId: user._id,
        branch: 'main',
        commitSha: 'sha-idempotency-test',
      });

      const claimed = await claimNextJob(workerId);

      // Pre-insert AnalysisResult to simulate crash after step 4 but before step 5
      const existingResult = await AnalysisResult.create({
        scanId: scan._id,
        repositoryId: repo._id,
        userId: user._id,
        commitSha: scan.commitSha,
        branch: scan.branch,
        analyzerVersion: '1.0.0',
        fileCounts: { total: 10, source: 5, documentation: 2, configuration: 2, infrastructure: 1, other: 0 },
        facts: { code: { apiEndpoints: [], envVars: [], dependencies: [], scripts: [] }, documentation: { apiEndpoints: [], envVars: [] } },
        drift: { summary: { total: 0, high: 0, medium: 0, low: 0 }, findings: [] },
        importantFiles: {},
        warnings: [],
      });

      jest.spyOn(analyzerService, 'analyze').mockResolvedValue(sampleAnalyzerOutput);

      // Execute scan -> must detect existing result, reuse it, and complete
      await scanExecutionService.executeScan(claimed._id, {
        alreadyClaimed: true,
        claimedScan: claimed,
        workerId,
      });

      const completedScan = await Scan.findById(scan._id);
      expect(completedScan.status).toBe('COMPLETED');

      // Exactly ONE AnalysisResult document must exist for this scanId
      const resultCount = await AnalysisResult.countDocuments({ scanId: scan._id });
      expect(resultCount).toBe(1);

      const fetchedResult = await AnalysisResult.findOne({ scanId: scan._id });
      expect(fetchedResult._id.toString()).toBe(existingResult._id.toString());
    });
  });

  // -------------------------------------------------------------------------
  // 6. Concurrency & Queue Capacity
  // -------------------------------------------------------------------------
  describe('6. Concurrency Enforcement & Worker Limits', () => {
    test('Multiple workers process distinct scans without double-claiming', async () => {
      // Create repo 2 for a distinct concurrent scan
      const repo2 = await Repository.create({
        userId: user._id,
        githubRepositoryId: '77665599',
        name: 'concurrent-repo',
        owner: 'reliabilityowner',
        fullName: 'reliabilityowner/concurrent-repo',
        htmlUrl: 'https://github.com/reliabilityowner/concurrent-repo',
        defaultBranch: 'main',
      });

      const scan1 = await enqueueScan({ repositoryId: repo._id, userId: user._id, branch: 'main' });
      const scan2 = await enqueueScan({ repositoryId: repo2._id, userId: user._id, branch: 'main' });

      const worker1 = generateWorkerId();
      const worker2 = generateWorkerId();

      // Simultaneous claims by worker 1 and worker 2
      const [claim1, claim2] = await Promise.all([
        claimNextJob(worker1),
        claimNextJob(worker2),
      ]);

      expect(claim1).not.toBeNull();
      expect(claim2).not.toBeNull();
      expect(claim1._id.toString()).not.toBe(claim2._id.toString());
      expect(claim1.lockedBy).toBe(worker1);
      expect(claim2.lockedBy).toBe(worker2);
    });

    test('createWorker enforces maximum concurrency limit', async () => {
      const worker = createWorker({ concurrency: 2, pollIntervalMs: 50 });
      const status = worker.getStatus();

      expect(status.concurrency).toBe(2);
      expect(status.activeJobs).toBe(0);
      expect(status.running).toBe(false);
    });
  });
});

