/**
 * Integration Tests: Scan API Contracts
 *
 * Verifies:
 * - Unauthenticated requests return HTTP 401
 * - Invalid repository ID format returns HTTP 404
 * - Non-existent or other user's repository returns HTTP 404
 * - POST /api/repositories/:id/scans creates a QUEUED scan and sets activeScanKey
 * - Duplicate active scan request returns HTTP 409 SCAN_ALREADY_IN_PROGRESS
 * - GET /api/repositories/:id/scans returns scan history
 * - GET /api/repositories/:id/scans/:scanId returns single scan status
 * - Successful scan execution transitions scan to COMPLETED and clears activeScanKey
 * - Failed analyzer execution transitions scan to FAILED and clears activeScanKey
 */

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../src/app');
const Scan = require('../../src/models/Scan');
const AnalysisResult = require('../../src/models/AnalysisResult');
const Repository = require('../../src/models/Repository');
const githubService = require('../../src/services/githubService');
const analyzerService = require('../../src/services/analyzerService');
const scanExecutionService = require('../../src/services/scanExecutionService');
const { connectTestDb, cleanTestDb, disconnectTestDb } = require('../helpers/testDb');
const { createAuthenticatedUser } = require('../helpers/authHelper');
const { sampleAnalyzerOutput } = require('../fixtures/analyzerOutput.fixture');

describe('Scan API Integration Tests (/api/repositories/:id/scans)', () => {
  let userA;
  let cookieA;
  let userB;
  let cookieB;
  let repoA;

  beforeAll(async () => {
    await connectTestDb();

    const authA = await createAuthenticatedUser({ name: 'User A', email: 'scan-user-a@codeatlas.test' });
    userA = authA.user;
    cookieA = authA.cookie;

    const authB = await createAuthenticatedUser({ name: 'User B', email: 'scan-user-b@codeatlas.test' });
    userB = authB.user;
    cookieB = authB.cookie;

    repoA = await Repository.create({
      userId: userA._id,
      githubRepositoryId: '12345678',
      name: 'scan-test-repo',
      owner: 'testowner',
      fullName: 'testowner/scan-test-repo',
      htmlUrl: 'https://github.com/testowner/scan-test-repo',
      defaultBranch: 'main',
    });
  });

  afterAll(async () => {
    await cleanTestDb();
    await disconnectTestDb();
  });

  describe('Authentication & Authorization', () => {
    test('returns 401 when creating scan without authentication', async () => {
      const res = await request(app).post(`/api/repositories/${repoA._id}/scans`);
      expect(res.status).toBe(401);
    });

    test('returns 404 when user B attempts to scan user A repository', async () => {
      const res = await request(app)
        .post(`/api/repositories/${repoA._id}/scans`)
        .set('Cookie', cookieB);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/not found/i);
    });

    test('returns 404 when repository ID is malformed', async () => {
      const res = await request(app)
        .post('/api/repositories/not-a-valid-id/scans')
        .set('Cookie', cookieA);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/not found/i);
    });
  });

  describe('Scan Creation & Concurrency Lock', () => {
    beforeEach(() => {
      jest.spyOn(githubService, 'resolveCommitSha').mockResolvedValue('179ae84efec61b14206d0305d941daed6c6d07f9');
      // Prevent automatic background execution from altering scan state immediately in this test block
      jest.spyOn(scanExecutionService, 'executeScan').mockImplementation(async () => {});
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('POST /api/repositories/:id/scans queues a new scan with activeScanKey', async () => {
      const res = await request(app)
        .post(`/api/repositories/${repoA._id}/scans`)
        .set('Cookie', cookieA);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.scan).toBeDefined();
      expect(res.body.scan.status).toBe('QUEUED');
      expect(res.body.scan.repositoryId).toBe(repoA._id.toString());
      expect(res.body.scan.commitSha).toBe('179ae84efec61b14206d0305d941daed6c6d07f9');

      // Verify activeScanKey in database
      const dbScan = await Scan.findById(res.body.scan._id);
      expect(dbScan.activeScanKey).toBe(repoA._id.toString());
    });

    test('returns 409 SCAN_ALREADY_IN_PROGRESS when attempting concurrent scan for same repo', async () => {
      const res = await request(app)
        .post(`/api/repositories/${repoA._id}/scans`)
        .set('Cookie', cookieA);

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('SCAN_ALREADY_IN_PROGRESS');
      expect(res.body.error.message).toMatch(/already in progress/i);
    });
  });

  describe('Scan Status & History', () => {
    let testScanId;

    beforeAll(async () => {
      // Find the queued scan created in previous test
      const scan = await Scan.findOne({ repositoryId: repoA._id });
      testScanId = scan._id.toString();
    });

    test('GET /api/repositories/:id/scans returns scan list for repository', async () => {
      const res = await request(app)
        .get(`/api/repositories/${repoA._id}/scans`)
        .set('Cookie', cookieA);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.scans).toBeDefined();
      expect(res.body.scans.length).toBeGreaterThanOrEqual(1);
      expect(res.body.scans[0].repositoryId).toBe(repoA._id.toString());
    });

    test('GET /api/repositories/:id/scans/:scanId returns scan status details', async () => {
      const res = await request(app)
        .get(`/api/repositories/${repoA._id}/scans/${testScanId}`)
        .set('Cookie', cookieA);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.scan).toBeDefined();
      expect(res.body.scan._id).toBe(testScanId);
    });

    test('User B cannot view User A scan details', async () => {
      const res = await request(app)
        .get(`/api/repositories/${repoA._id}/scans/${testScanId}`)
        .set('Cookie', cookieB);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('Execution Lifecycle & Lock Release', () => {
    test('successful scan transitions to COMPLETED, creates AnalysisResult, and releases activeScanKey', async () => {
      // Create a fresh repository for lifecycle testing
      const repo = await Repository.create({
        userId: userA._id,
        githubRepositoryId: '12345679',
        name: 'lifecycle-success-repo',
        owner: 'testowner',
        fullName: 'testowner/lifecycle-success-repo',
        htmlUrl: 'https://github.com/testowner/lifecycle-success-repo',
        defaultBranch: 'main',
      });

      const scan = await Scan.create({
        repositoryId: repo._id,
        userId: userA._id,
        status: 'QUEUED',
        branch: 'main',
        commitSha: 'sha-lifecycle-1',
        activeScanKey: repo._id.toString(),
      });

      // Mock analyzerService.analyze to return fixture
      jest.spyOn(analyzerService, 'analyze').mockResolvedValue(sampleAnalyzerOutput);

      // Execute scan directly
      await scanExecutionService.executeScan(scan._id);

      // Verify Scan document updated
      const updatedScan = await Scan.findById(scan._id);
      expect(updatedScan.status).toBe('COMPLETED');
      expect(updatedScan.activeScanKey).toBeNull();
      expect(updatedScan.completedAt).toBeInstanceOf(Date);
      expect(updatedScan.filesScanned).toBe(78);
      expect(updatedScan.findingsCount).toBe(1);

      // Verify AnalysisResult was created
      const result = await AnalysisResult.findOne({ scanId: scan._id });
      expect(result).not.toBeNull();
      expect(result.facts.code.apiEndpoints.length).toBe(2);

      jest.restoreAllMocks();
    });

    test('failed analyzer scan transitions to FAILED, records error, and releases activeScanKey', async () => {
      const repo = await Repository.create({
        userId: userA._id,
        githubRepositoryId: '12345680',
        name: 'lifecycle-fail-repo',
        owner: 'testowner',
        fullName: 'testowner/lifecycle-fail-repo',
        htmlUrl: 'https://github.com/testowner/lifecycle-fail-repo',
        defaultBranch: 'main',
      });

      const scan = await Scan.create({
        repositoryId: repo._id,
        userId: userA._id,
        status: 'QUEUED',
        branch: 'main',
        commitSha: 'sha-lifecycle-2',
        activeScanKey: repo._id.toString(),
      });

      // Mock analyzerService.analyze to throw unavailable error
      const mockErr = new Error('The analyzer service is currently unavailable.');
      mockErr.isAnalyzerError = true;
      mockErr.statusCode = 503;
      jest.spyOn(analyzerService, 'analyze').mockRejectedValue(mockErr);

      // Execute scan directly
      await scanExecutionService.executeScan(scan._id);

      // Verify Scan document updated
      const updatedScan = await Scan.findById(scan._id);
      expect(updatedScan.status).toBe('FAILED');
      expect(updatedScan.activeScanKey).toBeNull();
      expect(updatedScan.error).toMatch(/analyzer service is currently unavailable/i);

      // Verify NO AnalysisResult was created
      const result = await AnalysisResult.findOne({ scanId: scan._id });
      expect(result).toBeNull();

      jest.restoreAllMocks();
    });
  });
});
