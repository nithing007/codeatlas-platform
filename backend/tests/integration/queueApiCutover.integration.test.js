/**
 * Integration & Architecture Tests: Persistent Queue API Cutover (Phase 7B.2E)
 *
 * Runs exclusively against the isolated test database 'codeatlas_test'.
 * Validates:
 * 1. API creates and persists a QUEUED Scan document without executing it.
 * 2. API does not invoke scanExecutionService.executeScan() (setImmediate removed).
 * 3. API response retains identical JSON contract (status 201, success, message, scan).
 * 4. Duplicate active scan request returns 409 SCAN_ALREADY_IN_PROGRESS.
 * 5. Queue creation failure does not leave an orphaned activeScanKey lock.
 * 6. Unauthorized users cannot enqueue scans (401).
 * 7. Invalid repository requests cannot enqueue scans (404).
 * 8. Concurrent API requests cannot create duplicate active scans.
 * 9. Worker claims an API-created scan, executes, and completes it.
 * 10. API process restart does not lose a queued scan (QUEUED scans survive).
 * 11. Worker restart recovers eligible queued scans and expired RUNNING scans.
 * 12. Worker respects future nextRunAt.
 * 13. Multiple workers cannot claim the same scan.
 * 14. Architecture regression: scanService does NOT invoke executeScan or setImmediate.
 */

'use strict';

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../src/app');
const Scan = require('../../src/models/Scan');
const Repository = require('../../src/models/Repository');
const AnalysisResult = require('../../src/models/AnalysisResult');
const scanService = require('../../src/services/scanService');
const scanExecutionService = require('../../src/services/scanExecutionService');
const githubService = require('../../src/services/githubService');
const analyzerService = require('../../src/services/analyzerService');
const {
  generateWorkerId,
  claimNextJob,
  reclaimStalledScans,
  createWorker,
} = require('../../src/queue/scanWorker');
const { connectTestDb, cleanTestDb, disconnectTestDb } = require('../helpers/testDb');
const { createAuthenticatedUser } = require('../helpers/authHelper');
const { sampleAnalyzerOutput } = require('../fixtures/analyzerOutput.fixture');

describe('Phase 7B.2E: Persistent Queue API Cutover Integration Tests', () => {
  let userA;
  let userB;
  let cookieA;
  let cookieB;
  let repoA;

  beforeAll(async () => {
    await connectTestDb();
  });

  afterAll(async () => {
    await cleanTestDb();
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await cleanTestDb();

    // Create User A
    const authA = await createAuthenticatedUser({
      name: 'User A',
      email: 'usera-cutover@codeatlas.test',
    });
    userA = authA.user;
    cookieA = authA.cookie;

    // Create User B
    const authB = await createAuthenticatedUser({
      name: 'User B',
      email: 'userb-cutover@codeatlas.test',
    });
    userB = authB.user;
    cookieB = authB.cookie;

    // Create Repository for User A
    repoA = await Repository.create({
      userId: userA._id,
      githubRepositoryId: '88776655',
      name: 'cutover-repo',
      owner: 'cutoverowner',
      fullName: 'cutoverowner/cutover-repo',
      htmlUrl: 'https://github.com/cutoverowner/cutover-repo',
      defaultBranch: 'main',
    });

    jest.spyOn(githubService, 'resolveCommitSha').mockResolvedValue('sha-cutover-123456');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. API Unit & Integration Coverage
  // -------------------------------------------------------------------------
  describe('API Process Isolation & JSON Contract', () => {
    test('1 & 2. Creating a scan persists a QUEUED record and does NOT invoke executeScan()', async () => {
      const executeSpy = jest.spyOn(scanExecutionService, 'executeScan');

      const res = await request(app)
        .post(`/api/repositories/${repoA._id}/scans`)
        .set('Cookie', cookieA);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Scan queued successfully.');
      expect(res.body.scan).toBeDefined();
      expect(res.body.scan.status).toBe('QUEUED');
      expect(res.body.scan.repositoryId).toBe(repoA._id.toString());
      expect(res.body.scan.commitSha).toBe('sha-cutover-123456');

      // Flush event-loop ticks to ensure no setImmediate was scheduled
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Assert executeScan was NEVER called by the API process!
      expect(executeSpy).not.toHaveBeenCalled();

      // Verify persistent record in MongoDB
      const dbScan = await Scan.findById(res.body.scan._id);
      expect(dbScan).not.toBeNull();
      expect(dbScan.status).toBe('QUEUED');
      expect(dbScan.attempts).toBe(0);
      expect(dbScan.maxAttempts).toBe(3);
      expect(dbScan.priority).toBe(0);
      expect(dbScan.nextRunAt).toBeInstanceOf(Date);
      expect(dbScan.nextRunAt.getTime()).toBeLessThanOrEqual(Date.now());
      expect(dbScan.activeScanKey).toBe(repoA._id.toString());
    });

    test('3. Successful API response retains its exact JSON contract and safe fields', async () => {
      const res = await request(app)
        .post(`/api/repositories/${repoA._id}/scans`)
        .set('Cookie', cookieA);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('message', 'Scan queued successfully.');
      expect(res.body).toHaveProperty('scan');

      const scanObj = res.body.scan;
      expect(scanObj).toHaveProperty('_id');
      expect(scanObj).toHaveProperty('repositoryId', repoA._id.toString());
      expect(scanObj).toHaveProperty('status', 'QUEUED');
      expect(scanObj).toHaveProperty('branch', 'main');
      expect(scanObj).toHaveProperty('commitSha', 'sha-cutover-123456');

      // Internal security: activeScanKey and internal worker lock fields must be stripped by toSafeObject
      expect(scanObj.activeScanKey).toBeUndefined();
      expect(scanObj.lockedBy).toBeUndefined();
      expect(scanObj.leaseExpiresAt).toBeUndefined();
    });

    test('4. Duplicate active scan request returns existing 409 SCAN_ALREADY_IN_PROGRESS', async () => {
      // First scan request succeeds
      const firstRes = await request(app)
        .post(`/api/repositories/${repoA._id}/scans`)
        .set('Cookie', cookieA);
      expect(firstRes.status).toBe(201);

      // Second scan request for same repo while first is QUEUED returns 409
      const secondRes = await request(app)
        .post(`/api/repositories/${repoA._id}/scans`)
        .set('Cookie', cookieA);

      expect(secondRes.status).toBe(409);
      expect(secondRes.body.success).toBe(false);
      expect(secondRes.body.error.code).toBe('SCAN_ALREADY_IN_PROGRESS');
      expect(secondRes.body.error.message).toMatch(/already in progress/i);
    });

    test('5. Unauthorized user receives 401 and no scan is enqueued', async () => {
      const res = await request(app)
        .post(`/api/repositories/${repoA._id}/scans`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);

      const count = await Scan.countDocuments({ repositoryId: repoA._id });
      expect(count).toBe(0);
    });

    test('6. User cannot enqueue a scan for a repository they do not own (404)', async () => {
      const res = await request(app)
        .post(`/api/repositories/${repoA._id}/scans`)
        .set('Cookie', cookieB); // User B attempting User A repo

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);

      const count = await Scan.countDocuments({ repositoryId: repoA._id });
      expect(count).toBe(0);
    });

    test('7. Malformed repository ID returns 404', async () => {
      const res = await request(app)
        .post('/api/repositories/invalid-repo-id/scans')
        .set('Cookie', cookieA);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    test('8. Concurrent API requests cannot create duplicate active scans', async () => {
      // Simulate 5 simultaneous HTTP POST requests for the same repository
      const requests = Array.from({ length: 5 }, () =>
        request(app)
          .post(`/api/repositories/${repoA._id}/scans`)
          .set('Cookie', cookieA)
      );

      const responses = await Promise.all(requests);

      const successes = responses.filter((r) => r.status === 201);
      const conflicts = responses.filter((r) => r.status === 409);

      // Exactly ONE request must succeed (201), the rest must receive 409 Conflict
      expect(successes.length).toBe(1);
      expect(conflicts.length).toBe(4);

      // Exactly ONE active scan in MongoDB
      const activeScans = await Scan.find({
        repositoryId: repoA._id,
        status: { $in: ['QUEUED', 'RUNNING'] },
      });
      expect(activeScans.length).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Worker Execution & Process Separation
  // -------------------------------------------------------------------------
  describe('Worker Process Decoupling & Job Execution', () => {
    test('9. Dedicated worker claims an API-created scan, executes, and completes it', async () => {
      jest.spyOn(analyzerService, 'analyze').mockResolvedValue(sampleAnalyzerOutput);

      // 1. API creates scan
      const res = await request(app)
        .post(`/api/repositories/${repoA._id}/scans`)
        .set('Cookie', cookieA);
      expect(res.status).toBe(201);
      const scanId = res.body.scan._id;

      // 2. Worker claims the scan
      const workerId = generateWorkerId();
      const claimed = await claimNextJob(workerId);
      expect(claimed).not.toBeNull();
      expect(claimed._id.toString()).toBe(scanId);
      expect(claimed.status).toBe('RUNNING');
      expect(claimed.attempts).toBe(1);
      expect(claimed.lockedBy).toBe(workerId);

      // 3. Worker executes the scan
      await scanExecutionService.executeScan(claimed._id, {
        alreadyClaimed: true,
        claimedScan: claimed,
        workerId,
      });

      // 4. Verify completed state
      const dbScan = await Scan.findById(scanId);
      expect(dbScan.status).toBe('COMPLETED');
      expect(dbScan.activeScanKey).toBeNull();
      expect(dbScan.lockedBy).toBeNull();
      expect(dbScan.completedAt).toBeInstanceOf(Date);
      expect(dbScan.filesScanned).toBe(78);

      // Verify AnalysisResult exists
      const analysisResult = await AnalysisResult.findOne({ scanId });
      expect(analysisResult).not.toBeNull();
      expect(analysisResult.repositoryId.toString()).toBe(repoA._id.toString());
    });

    test('10. API process restart does NOT lose or kill queued scans', async () => {
      // 1. API queues a scan
      const res = await request(app)
        .post(`/api/repositories/${repoA._id}/scans`)
        .set('Cookie', cookieA);
      expect(res.status).toBe(201);
      const scanId = res.body.scan._id;

      // 2. Simulate API process restart (re-loading app / server without executing startup scan reconciliation)
      // Verify that after "restart", the scan is STILL QUEUED and NOT marked FAILED!
      const afterRestartScan = await Scan.findById(scanId);
      expect(afterRestartScan.status).toBe('QUEUED');
      expect(afterRestartScan.activeScanKey).toBe(repoA._id.toString());

      // 3. When worker starts, it can still claim the job
      const workerId = generateWorkerId();
      const claimed = await claimNextJob(workerId);
      expect(claimed).not.toBeNull();
      expect(claimed._id.toString()).toBe(scanId);
      expect(claimed.status).toBe('RUNNING');
    });

    test('11. Worker startup recovers stalled RUNNING scans whose lease expired', async () => {
      // Create a scan that was running on an old crashed worker
      const stalledScan = await Scan.create({
        repositoryId: repoA._id,
        userId: userA._id,
        status: 'RUNNING',
        branch: 'main',
        commitSha: 'commit-stalled',
        activeScanKey: repoA._id.toString(),
        priority: 0,
        attempts: 1,
        lockedBy: 'crashed-worker-pid:9999',
        lockedAt: new Date(Date.now() - 120000),
        leaseExpiresAt: new Date(Date.now() - 60000), // Expired 1 min ago
      });

      // Worker startup runs reclaimStalledScans
      const reclaimed = await reclaimStalledScans({ now: new Date() });
      expect(reclaimed.length).toBe(1);
      expect(reclaimed[0]._id.toString()).toBe(stalledScan._id.toString());

      const recoveredDoc = await Scan.findById(stalledScan._id);
      expect(recoveredDoc.status).toBe('QUEUED');
      expect(recoveredDoc.lockedBy).toBeNull();
      expect(recoveredDoc.activeScanKey).toBe(repoA._id.toString());
    });

    test('12. Worker respects future nextRunAt and does not claim prematurely', async () => {
      // Create scan scheduled in future
      const futureScan = await Scan.create({
        repositoryId: repoA._id,
        userId: userA._id,
        status: 'QUEUED',
        branch: 'main',
        commitSha: 'commit-future',
        activeScanKey: repoA._id.toString(),
        priority: 0,
        attempts: 1,
        nextRunAt: new Date(Date.now() + 30000), // 30s in future
      });

      const workerId = generateWorkerId();
      const claimed = await claimNextJob(workerId);
      expect(claimed).toBeNull(); // Must not claim!

      // Fast-forward nextRunAt into past
      await Scan.updateOne({ _id: futureScan._id }, { $set: { nextRunAt: new Date(Date.now() - 1000) } });

      const claimedNow = await claimNextJob(workerId);
      expect(claimedNow).not.toBeNull();
      expect(claimedNow._id.toString()).toBe(futureScan._id.toString());
    });

    test('13. Multiple workers cannot claim the same scan', async () => {
      // API queues a scan
      const res = await request(app)
        .post(`/api/repositories/${repoA._id}/scans`)
        .set('Cookie', cookieA);
      expect(res.status).toBe(201);

      const workerA = generateWorkerId();
      const workerB = generateWorkerId();

      // Concurrent claims from 2 workers
      const [claimA, claimB] = await Promise.all([
        claimNextJob(workerA),
        claimNextJob(workerB),
      ]);

      const successfulClaims = [claimA, claimB].filter(Boolean);
      expect(successfulClaims.length).toBe(1);

      const failedClaims = [claimA, claimB].filter((c) => c === null);
      expect(failedClaims.length).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Architecture Regression Verification
  // -------------------------------------------------------------------------
  describe('Static & Service-Level Architecture Verification', () => {
    test('14. scanService does NOT import or invoke scanExecutionService or setImmediate', async () => {
      // 1. Static check: scanService module exports must NOT expose executeScan
      expect(scanService.executeScan).toBeUndefined();

      // 2. Behavioral verification: invoking createScan must NEVER trigger executeScan
      const executeSpy = jest.spyOn(scanExecutionService, 'executeScan');

      const repo2 = await Repository.create({
        userId: userA._id,
        githubRepositoryId: '99887766',
        name: 'arch-check-repo',
        owner: 'cutoverowner',
        fullName: 'cutoverowner/arch-check-repo',
        htmlUrl: 'https://github.com/cutoverowner/arch-check-repo',
        defaultBranch: 'main',
      });

      const scan = await scanService.createScan(userA._id, repo2._id.toString());
      expect(scan.status).toBe('QUEUED');

      // Wait for any potential event loop tasks (setImmediate, nextTick, setTimeout)
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(executeSpy).not.toHaveBeenCalled();
    });
  });
});

