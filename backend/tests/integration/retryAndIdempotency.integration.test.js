/**
 * Integration Tests: Retry Strategy, Terminal Failure & Idempotent Persistence (Phase 7B.2D)
 *
 * Runs exclusively against the isolated test database 'codeatlas_test' using real MongoDB queries.
 * Validates:
 * 1. Transient failure requeues the scan (status: 'QUEUED')
 * 2. Retry sets a future nextRunAt (now + backoff)
 * 3. A queued scan is not claimable before nextRunAt
 * 4. A queued scan becomes claimable after nextRunAt
 * 5. Attempt count increases on claim, not on retry transition
 * 6. Permanent failure becomes terminal immediately (status: 'FAILED', completedAt set)
 * 7. Third failed execution becomes terminal (attempts >= 3 -> FAILED)
 * 8. Retry preserves the active scan lock (activeScanKey)
 * 9. Terminal failure releases the active scan lock (activeScanKey: null)
 * 10. Stale worker cannot update a scan after ownership changes (returns null)
 * 11. Existing AnalysisResult is reused after simulated crash between persistence and completion
 * 12. Repeated result persistence does not create duplicate documents
 * 13. A duplicate-key error for an unrelated unique index is not silently accepted
 * 14. Lease recovery and retry handling work together
 */

'use strict';

const mongoose = require('mongoose');
const {
  generateWorkerId,
  claimNextJob,
  scheduleRetry,
  markTerminalFailure,
  reclaimStalledScans,
} = require('../../src/queue/scanWorker');
const { enqueueScan } = require('../../src/queue/scanQueue');
const Scan = require('../../src/models/Scan');
const Repository = require('../../src/models/Repository');
const AnalysisResult = require('../../src/models/AnalysisResult');
const scanExecutionService = require('../../src/services/scanExecutionService');
const analyzerService = require('../../src/services/analyzerService');
const { connectTestDb, cleanTestDb, disconnectTestDb } = require('../helpers/testDb');
const { createAuthenticatedUser } = require('../helpers/authHelper');
const { sampleAnalyzerOutput } = require('../fixtures/analyzerOutput.fixture');

describe('Phase 7B.2D Integration Tests: Retry Strategy & Idempotency', () => {
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

    const auth = await createAuthenticatedUser({
      name: 'Retry Test User',
      email: 'retry-user@codeatlas.test',
    });
    user = auth.user;

    repo = await Repository.create({
      userId: user._id,
      githubRepositoryId: '11223344',
      name: 'retry-repo',
      owner: 'retryowner',
      fullName: 'retryowner/retry-repo',
      htmlUrl: 'https://github.com/retryowner/retry-repo',
      defaultBranch: 'main',
    });
  });

  // -------------------------------------------------------------------------
  // 1. Transient failure requeues the scan
  // -------------------------------------------------------------------------
  test('1. Transient failure requeues the scan (status: QUEUED)', async () => {
    const workerId = generateWorkerId();
    const scan = await Scan.create({
      repositoryId: repo._id,
      userId: user._id,
      status: 'QUEUED',
      branch: 'main',
      commitSha: 'commit111',
      activeScanKey: repo._id.toString(),
      priority: 0,
      attempts: 0,
      nextRunAt: new Date(),
    });

    // Claim the job -> attempts becomes 1, status RUNNING
    const claimed = await claimNextJob(workerId);
    expect(claimed._id.toString()).toBe(scan._id.toString());
    expect(claimed.status).toBe('RUNNING');
    expect(claimed.attempts).toBe(1);

    // Mock analyzerService.analyze to throw a retryable HTTP 503 error
    const origAnalyze = analyzerService.analyze;
    const transientErr = new Error('Analyzer unavailable');
    transientErr.statusCode = 503;
    transientErr.isAnalyzerError = true;
    analyzerService.analyze = jest.fn().mockRejectedValue(transientErr);

    try {
      await scanExecutionService.executeScan(claimed._id, {
        alreadyClaimed: true,
        claimedScan: claimed,
        workerId,
      });

      const updated = await Scan.findById(scan._id);
      expect(updated.status).toBe('QUEUED');
      expect(updated.lockedBy).toBeNull();
      expect(updated.lockedAt).toBeNull();
      expect(updated.leaseExpiresAt).toBeNull();
      expect(updated.lastError).toContain('unavailable');
      expect(updated.completedAt).toBeNull();
    } finally {
      analyzerService.analyze = origAnalyze;
    }
  });

  // -------------------------------------------------------------------------
  // 2. Retry sets a future nextRunAt
  // -------------------------------------------------------------------------
  test('2. Retry sets a future nextRunAt (now + backoff for attempt 1: 10s)', async () => {
    const workerId = generateWorkerId();
    const scan = await Scan.create({
      repositoryId: repo._id,
      userId: user._id,
      status: 'QUEUED',
      branch: 'main',
      commitSha: 'commit222',
      activeScanKey: repo._id.toString(),
      priority: 0,
      attempts: 0,
      nextRunAt: new Date(),
    });

    const claimed = await claimNextJob(workerId);
    const beforeRetry = Date.now();

    const origAnalyze = analyzerService.analyze;
    const transientErr = new Error('Gateway timeout');
    transientErr.statusCode = 504;
    transientErr.isAnalyzerError = true;
    analyzerService.analyze = jest.fn().mockRejectedValue(transientErr);

    try {
      await scanExecutionService.executeScan(claimed._id, {
        alreadyClaimed: true,
        claimedScan: claimed,
        workerId,
      });

      const updated = await Scan.findById(scan._id);
      expect(updated.status).toBe('QUEUED');
      expect(updated.nextRunAt).toBeInstanceOf(Date);

      // Backoff for attempt 1 is 10,000 ms (10s)
      const diffMs = updated.nextRunAt.getTime() - beforeRetry;
      expect(diffMs).toBeGreaterThanOrEqual(9500);
      expect(diffMs).toBeLessThanOrEqual(12000);
    } finally {
      analyzerService.analyze = origAnalyze;
    }
  });

  // -------------------------------------------------------------------------
  // 3. A queued scan is not claimable before nextRunAt
  // -------------------------------------------------------------------------
  test('3. A queued scan is not claimable before nextRunAt', async () => {
    const futureDate = new Date(Date.now() + 60000); // 60s in future
    await Scan.create({
      repositoryId: repo._id,
      userId: user._id,
      status: 'QUEUED',
      branch: 'main',
      commitSha: 'commit333',
      activeScanKey: repo._id.toString(),
      priority: 0,
      attempts: 1,
      nextRunAt: futureDate,
    });

    const workerId = generateWorkerId();
    const claimed = await claimNextJob(workerId);
    expect(claimed).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 4. A queued scan becomes claimable after nextRunAt
  // -------------------------------------------------------------------------
  test('4. A queued scan becomes claimable after nextRunAt', async () => {
    const pastDate = new Date(Date.now() - 5000); // 5s in past
    const scan = await Scan.create({
      repositoryId: repo._id,
      userId: user._id,
      status: 'QUEUED',
      branch: 'main',
      commitSha: 'commit444',
      activeScanKey: repo._id.toString(),
      priority: 0,
      attempts: 1,
      nextRunAt: pastDate,
    });

    const workerId = generateWorkerId();
    const claimed = await claimNextJob(workerId);
    expect(claimed).not.toBeNull();
    expect(claimed._id.toString()).toBe(scan._id.toString());
    expect(claimed.status).toBe('RUNNING');
    expect(claimed.attempts).toBe(2);
  });

  // -------------------------------------------------------------------------
  // 5. Attempt count increases on claim, not on retry transition
  // -------------------------------------------------------------------------
  test('5. Attempt count increases on claim, not on retry transition', async () => {
    const worker1 = generateWorkerId();
    const scan = await Scan.create({
      repositoryId: repo._id,
      userId: user._id,
      status: 'QUEUED',
      branch: 'main',
      commitSha: 'commit555',
      activeScanKey: repo._id.toString(),
      priority: 0,
      attempts: 0,
      nextRunAt: new Date(),
    });

    // 1st claim -> attempts 1
    const claim1 = await claimNextJob(worker1);
    expect(claim1.attempts).toBe(1);

    // Schedule retry -> attempts remains 1
    const retried = await scheduleRetry(
      claim1,
      { sanitizedMessage: 'Transient error 1' },
      worker1,
      new Date()
    );
    expect(retried.status).toBe('QUEUED');
    expect(retried.attempts).toBe(1);

    const docAfterRetry = await Scan.findById(scan._id);
    expect(docAfterRetry.attempts).toBe(1);

    // Make it immediately claimable
    await Scan.updateOne({ _id: scan._id }, { $set: { nextRunAt: new Date(Date.now() - 1000) } });

    // 2nd claim by worker2 -> attempts increments to 2
    const worker2 = generateWorkerId();
    const claim2 = await claimNextJob(worker2);
    expect(claim2._id.toString()).toBe(scan._id.toString());
    expect(claim2.attempts).toBe(2);
  });

  // -------------------------------------------------------------------------
  // 6. Permanent failure becomes terminal immediately
  // -------------------------------------------------------------------------
  test('6. Permanent failure becomes terminal immediately (status: FAILED, completedAt set)', async () => {
    const workerId = generateWorkerId();
    const scan = await Scan.create({
      repositoryId: repo._id,
      userId: user._id,
      status: 'QUEUED',
      branch: 'invalid-branch',
      commitSha: 'commit666',
      activeScanKey: repo._id.toString(),
      priority: 0,
      attempts: 0,
      nextRunAt: new Date(),
    });

    const claimed = await claimNextJob(workerId);
    expect(claimed.attempts).toBe(1);

    // Mock analyzer throwing permanent 404 (Not Found)
    const origAnalyze = analyzerService.analyze;
    const notFoundErr = new Error('Repository or branch not found on GitHub');
    notFoundErr.statusCode = 404;
    notFoundErr.isAnalyzerError = true;
    analyzerService.analyze = jest.fn().mockRejectedValue(notFoundErr);

    try {
      await scanExecutionService.executeScan(claimed._id, {
        alreadyClaimed: true,
        claimedScan: claimed,
        workerId,
      });

      const updated = await Scan.findById(scan._id);
      expect(updated.status).toBe('FAILED');
      expect(updated.completedAt).toBeInstanceOf(Date);
      expect(updated.error).toContain('not found');
      expect(updated.lockedBy).toBeNull();
      expect(updated.leaseExpiresAt).toBeNull();
      expect(updated.activeScanKey).toBeNull();
    } finally {
      analyzerService.analyze = origAnalyze;
    }
  });

  // -------------------------------------------------------------------------
  // 7. Third failed execution becomes terminal
  // -------------------------------------------------------------------------
  test('7. Third failed execution becomes terminal (attempts >= 3 -> FAILED)', async () => {
    const workerId = generateWorkerId();
    // Simulate scan that is already on attempt 2 (so claiming it makes it attempt 3)
    const scan = await Scan.create({
      repositoryId: repo._id,
      userId: user._id,
      status: 'QUEUED',
      branch: 'main',
      commitSha: 'commit777',
      activeScanKey: repo._id.toString(),
      priority: 0,
      attempts: 2,
      maxAttempts: 3,
      nextRunAt: new Date(),
    });

    // Claim -> attempts increments to 3
    const claimed = await claimNextJob(workerId);
    expect(claimed.attempts).toBe(3);

    // Mock transient 503 error
    const origAnalyze = analyzerService.analyze;
    const transientErr = new Error('Transient 503 failure');
    transientErr.statusCode = 503;
    transientErr.isAnalyzerError = true;
    analyzerService.analyze = jest.fn().mockRejectedValue(transientErr);

    try {
      await scanExecutionService.executeScan(claimed._id, {
        alreadyClaimed: true,
        claimedScan: claimed,
        workerId,
      });

      const updated = await Scan.findById(scan._id);
      // Since attempts reached maxAttempts (3 >= 3), must transition to FAILED
      expect(updated.status).toBe('FAILED');
      expect(updated.completedAt).toBeInstanceOf(Date);
      expect(updated.lockedBy).toBeNull();
      expect(updated.activeScanKey).toBeNull();
    } finally {
      analyzerService.analyze = origAnalyze;
    }
  });

  // -------------------------------------------------------------------------
  // 8. Retry preserves the active scan lock
  // -------------------------------------------------------------------------
  test('8. Retry preserves the active scan lock (activeScanKey)', async () => {
    const workerId = generateWorkerId();
    const scan = await Scan.create({
      repositoryId: repo._id,
      userId: user._id,
      status: 'QUEUED',
      branch: 'main',
      commitSha: 'commit888',
      activeScanKey: repo._id.toString(),
      priority: 0,
      attempts: 0,
      nextRunAt: new Date(),
    });

    const claimed = await claimNextJob(workerId);
    await scheduleRetry(claimed, { sanitizedMessage: 'Transient error' }, workerId);

    const retriedScan = await Scan.findById(scan._id);
    expect(retriedScan.status).toBe('QUEUED');
    expect(retriedScan.activeScanKey).toBe(repo._id.toString());

    // Attempting to enqueue another scan for the same repository must throw 409
    await expect(
      enqueueScan({
        repositoryId: repo._id,
        userId: user._id,
        branch: 'main',
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'SCAN_ALREADY_IN_PROGRESS',
    });
  });

  // -------------------------------------------------------------------------
  // 9. Terminal failure releases the active scan lock
  // -------------------------------------------------------------------------
  test('9. Terminal failure releases the active scan lock (activeScanKey: null)', async () => {
    const workerId = generateWorkerId();
    const scan = await Scan.create({
      repositoryId: repo._id,
      userId: user._id,
      status: 'QUEUED',
      branch: 'main',
      commitSha: 'commit999',
      activeScanKey: repo._id.toString(),
      priority: 0,
      attempts: 0,
      nextRunAt: new Date(),
    });

    const claimed = await claimNextJob(workerId);
    await markTerminalFailure(claimed._id, 'Fatal error', workerId);

    const failedScan = await Scan.findById(scan._id);
    expect(failedScan.status).toBe('FAILED');
    expect(failedScan.activeScanKey).toBeNull();

    // Now a new scan can be successfully enqueued for the same repository
    const newScan = await enqueueScan({
      repositoryId: repo._id,
      userId: user._id,
      branch: 'main',
    });
    expect(newScan).toBeDefined();
    expect(newScan.status).toBe('QUEUED');
    expect(newScan.activeScanKey).toBe(repo._id.toString());
  });

  // -------------------------------------------------------------------------
  // 10. Stale worker cannot update a scan after ownership changes
  // -------------------------------------------------------------------------
  test('10. Stale worker cannot update a scan after ownership changes (returns null)', async () => {
    const workerA = generateWorkerId();
    const workerB = generateWorkerId();

    const scan = await Scan.create({
      repositoryId: repo._id,
      userId: user._id,
      status: 'QUEUED',
      branch: 'main',
      commitSha: 'commit1010',
      activeScanKey: repo._id.toString(),
      priority: 0,
      attempts: 0,
      nextRunAt: new Date(),
    });

    // Worker A claims the scan
    const claimedByA = await claimNextJob(workerA);
    expect(claimedByA.lockedBy).toBe(workerA);

    // Simulate Worker A losing the lease: Worker B reclaims it
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

    // Worker A now attempts scheduleRetry -> returns null
    const retryResult = await scheduleRetry(
      claimedByA,
      { sanitizedMessage: 'Delayed response from A' },
      workerA
    );
    expect(retryResult).toBeNull();

    // Worker A attempts markTerminalFailure -> returns null
    const failResult = await markTerminalFailure(
      claimedByA._id,
      'Delayed failure from A',
      workerA
    );
    expect(failResult).toBeNull();

    // Database document remains locked by Worker B
    const doc = await Scan.findById(scan._id);
    expect(doc.status).toBe('RUNNING');
    expect(doc.lockedBy).toBe(workerB);
  });

  // -------------------------------------------------------------------------
  // 11. Existing AnalysisResult is reused after simulated crash between persistence and completion
  // -------------------------------------------------------------------------
  test('11. Existing AnalysisResult is reused after simulated crash between persistence and completion', async () => {
    const workerA = generateWorkerId();
    const scan = await Scan.create({
      repositoryId: repo._id,
      userId: user._id,
      status: 'QUEUED',
      branch: 'main',
      commitSha: 'commit1111',
      activeScanKey: repo._id.toString(),
      priority: 0,
      attempts: 0,
      nextRunAt: new Date(),
    });

    const claimedA = await claimNextJob(workerA);

    // Pre-create AnalysisResult in MongoDB to simulate worker crash right after step 4
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

    // Mock analyzerService.analyze returning sample output
    const origAnalyze = analyzerService.analyze;
    analyzerService.analyze = jest.fn().mockResolvedValue(sampleAnalyzerOutput);

    try {
      // Execute scan with worker A -> should detect existing result, reuse it, and complete
      await scanExecutionService.executeScan(claimedA._id, {
        alreadyClaimed: true,
        claimedScan: claimedA,
        workerId: workerA,
      });

      const updatedScan = await Scan.findById(scan._id);
      expect(updatedScan.status).toBe('COMPLETED');
      expect(updatedScan.activeScanKey).toBeNull();

      // Verify no duplicate AnalysisResult was created
      const count = await AnalysisResult.countDocuments({ scanId: scan._id });
      expect(count).toBe(1);

      const loadedResult = await AnalysisResult.findOne({ scanId: scan._id });
      expect(loadedResult._id.toString()).toBe(existingResult._id.toString());
    } finally {
      analyzerService.analyze = origAnalyze;
    }
  });

  // -------------------------------------------------------------------------
  // 12. Repeated result persistence does not create duplicate documents
  // -------------------------------------------------------------------------
  test('12. Repeated result persistence does not create duplicate documents', async () => {
    const workerId = generateWorkerId();
    const scan = await Scan.create({
      repositoryId: repo._id,
      userId: user._id,
      status: 'QUEUED',
      branch: 'main',
      commitSha: 'commit1212',
      activeScanKey: repo._id.toString(),
      priority: 0,
      attempts: 0,
      nextRunAt: new Date(),
    });

    const claimed = await claimNextJob(workerId);

    const origAnalyze = analyzerService.analyze;
    analyzerService.analyze = jest.fn().mockResolvedValue(sampleAnalyzerOutput);

    try {
      // First run to completion
      await scanExecutionService.executeScan(claimed._id, {
        alreadyClaimed: true,
        claimedScan: claimed,
        workerId,
      });

      const initialCount = await AnalysisResult.countDocuments({ scanId: scan._id });
      expect(initialCount).toBe(1);

      // Attempt to execute again (simulating rerun)
      await scanExecutionService.executeScan(claimed._id, {
        alreadyClaimed: true,
        claimedScan: claimed,
        workerId,
      });

      const secondCount = await AnalysisResult.countDocuments({ scanId: scan._id });
      expect(secondCount).toBe(1);
    } finally {
      analyzerService.analyze = origAnalyze;
    }
  });

  // -------------------------------------------------------------------------
  // 13. A duplicate-key error for an unrelated unique index is not silently accepted
  // -------------------------------------------------------------------------
  test('13. A duplicate-key error for an unrelated unique index is not silently accepted', async () => {
    const workerId = generateWorkerId();
    const scan = await Scan.create({
      repositoryId: repo._id,
      userId: user._id,
      status: 'QUEUED',
      branch: 'main',
      commitSha: 'commit1313',
      activeScanKey: repo._id.toString(),
      priority: 0,
      attempts: 0,
      nextRunAt: new Date(),
    });

    const claimed = await claimNextJob(workerId);

    const origAnalyze = analyzerService.analyze;
    const origCreate = AnalysisResult.create;

    analyzerService.analyze = jest.fn().mockResolvedValue(sampleAnalyzerOutput);

    // Simulate code 11000 duplicate key on an UNRELATED unique index (not scanId)
    const unrelatedDupErr = new Error('E11000 duplicate key error collection: index: unrelatedIndex_1 dup key: { unrelated: "dup" }');
    unrelatedDupErr.code = 11000;
    unrelatedDupErr.keyPattern = { unrelatedIndex: 1 };
    AnalysisResult.create = jest.fn().mockRejectedValue(unrelatedDupErr);

    try {
      await scanExecutionService.executeScan(claimed._id, {
        alreadyClaimed: true,
        claimedScan: claimed,
        workerId,
      });

      const updatedScan = await Scan.findById(scan._id);
      // Since it is an unexpected/unrelated error, it is classified as permanent failure, not reused
      expect(updatedScan.status).toBe('FAILED');
      expect(updatedScan.error).toBeDefined();
    } finally {
      analyzerService.analyze = origAnalyze;
      AnalysisResult.create = origCreate;
    }
  });

  // -------------------------------------------------------------------------
  // 14. Lease recovery and retry handling work together
  // -------------------------------------------------------------------------
  test('14. Lease recovery and retry handling work together', async () => {
    const worker1 = generateWorkerId();
    const scan = await Scan.create({
      repositoryId: repo._id,
      userId: user._id,
      status: 'QUEUED',
      branch: 'main',
      commitSha: 'commit1414',
      activeScanKey: repo._id.toString(),
      priority: 0,
      attempts: 0,
      nextRunAt: new Date(),
    });

    // 1. Worker 1 claims scan -> RUNNING, attempts: 1
    const claimed1 = await claimNextJob(worker1);
    expect(claimed1.attempts).toBe(1);

    // 2. Simulate Worker 1 crashing: lease expires 2 minutes in the past
    await Scan.updateOne(
      { _id: scan._id },
      {
        $set: {
          leaseExpiresAt: new Date(Date.now() - 120000),
          lockedAt: new Date(Date.now() - 120000),
        },
      }
    );

    // 3. Lease reaper runs and reclaims the stalled scan -> QUEUED, activeScanKey preserved
    const reclaimed = await reclaimStalledScans({ now: new Date() });
    expect(reclaimed.length).toBe(1);
    expect(reclaimed[0]._id.toString()).toBe(scan._id.toString());
    expect(reclaimed[0].status).toBe('QUEUED');
    expect(reclaimed[0].lockedBy).toBeNull();
    expect(reclaimed[0].activeScanKey).toBe(repo._id.toString());

    // 4. Worker 2 claims the reclaimed scan -> attempts becomes 2
    const worker2 = generateWorkerId();
    const claimed2 = await claimNextJob(worker2);
    expect(claimed2._id.toString()).toBe(scan._id.toString());
    expect(claimed2.attempts).toBe(2);

    // 5. Worker 2 encounters transient error -> schedules retry with attempt 2 backoff (20s)
    const beforeRetry = Date.now();
    const retried = await scheduleRetry(
      claimed2,
      { sanitizedMessage: 'Temporary 503 from analyzer' },
      worker2,
      new Date(beforeRetry)
    );

    expect(retried.status).toBe('QUEUED');
    expect(retried.attempts).toBe(2);
    expect(retried.activeScanKey).toBe(repo._id.toString());

    // Delay for attempt 2 is 20,000 ms (20s)
    const expectedDelayMs = 20000;
    expect(retried.nextRunAt.getTime()).toBe(beforeRetry + expectedDelayMs);
  });
});

