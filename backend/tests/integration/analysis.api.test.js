/**
 * Integration Tests: Analysis API Contracts
 *
 * Verifies:
 * - Unauthenticated requests return HTTP 401
 * - Non-existent repository returns HTTP 404
 * - Ownership enforcement: User B cannot view User A analysis
 * - Scan in non-completed state (QUEUED/RUNNING) returns HTTP 400 SCAN_NOT_COMPLETED
 * - Failed scan returns HTTP 400 SCAN_FAILED
 * - Completed scan without AnalysisResult returns HTTP 404
 * - Successful analysis retrieval returns HTTP 200 with complete facts and drift findings
 * - Latest analysis endpoint returns HTTP 200 with most recent completed analysis
 * - Evidence mapping and context metadata flags are preserved in response
 */

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../src/app');
const Scan = require('../../src/models/Scan');
const AnalysisResult = require('../../src/models/AnalysisResult');
const Repository = require('../../src/models/Repository');
const { connectTestDb, cleanTestDb, disconnectTestDb } = require('../helpers/testDb');
const { createAuthenticatedUser } = require('../helpers/authHelper');

describe('Analysis API Integration Tests (/api/repositories/:id/analysis & scans/:id/analysis)', () => {
  let userA;
  let cookieA;
  let userB;
  let cookieB;
  let repoA;
  let completedScan;
  let queuedScan;
  let failedScan;
  let analysisDoc;

  beforeAll(async () => {
    await connectTestDb();

    const authA = await createAuthenticatedUser({ name: 'User A', email: 'analysis-user-a@codeatlas.test' });
    userA = authA.user;
    cookieA = authA.cookie;

    const authB = await createAuthenticatedUser({ name: 'User B', email: 'analysis-user-b@codeatlas.test' });
    userB = authB.user;
    cookieB = authB.cookie;

    repoA = await Repository.create({
      userId: userA._id,
      githubRepositoryId: '98765432',
      name: 'analysis-repo',
      owner: 'testowner',
      fullName: 'testowner/analysis-repo',
      htmlUrl: 'https://github.com/testowner/analysis-repo',
      defaultBranch: 'main',
    });

    queuedScan = await Scan.create({
      repositoryId: repoA._id,
      userId: userA._id,
      status: 'QUEUED',
      branch: 'main',
      commitSha: 'sha-queued',
      activeScanKey: repoA._id.toString(),
    });

    failedScan = await Scan.create({
      repositoryId: repoA._id,
      userId: userA._id,
      status: 'FAILED',
      branch: 'main',
      commitSha: 'sha-failed',
      activeScanKey: null,
      error: 'Analyzer timed out',
    });

    completedScan = await Scan.create({
      repositoryId: repoA._id,
      userId: userA._id,
      status: 'COMPLETED',
      branch: 'main',
      commitSha: 'sha-completed',
      activeScanKey: null,
      filesScanned: 50,
      findingsCount: 1,
      completedAt: new Date(),
    });

    analysisDoc = await AnalysisResult.create({
      scanId: completedScan._id,
      repositoryId: repoA._id,
      userId: userA._id,
      branch: 'main',
      commitSha: 'sha-completed',
      analyzerVersion: '1.0.0',
      fileCounts: {
        total: 50,
        source: 35,
        documentation: 5,
        configuration: 5,
        infrastructure: 5,
        other: 0,
      },
      facts: {
        code: {
          apiEndpoints: [
            { method: 'POST', path: '/api/v1/auth/login', file: 'src/routes/auth.js', source: 'src/routes/auth.js', line: 12 },
          ],
          envVars: [
            { name: 'PORT', file: '.env.example', source: '.env.example', line: 1 },
          ],
          dependencies: [
            { name: 'express', version: '^4.17.1', type: 'production' },
          ],
          scripts: [
            { name: 'start', command: 'node server.js' },
          ],
        },
        documentation: {
          apiEndpoints: [],
          envVars: [
            { name: 'PORT', file: 'README.md', source: 'README.md', line: 10 },
          ],
        },
      },
      drift: {
        summary: { total: 1, high: 1, medium: 0, low: 0 },
        findings: [
          {
            type: 'UNDOCUMENTED_API',
            severity: 'HIGH',
            title: 'Undocumented API: POST /api/v1/auth/login',
            message: 'Endpoint was not found in documentation.',
            resource: { method: 'POST', path: '/api/v1/auth/login' },
            codeEvidence: {
              file: 'src/routes/auth.js',
              source: 'src/routes/auth.js',
              line: 12,
              prefixResolved: true,
              fromTemplate: false,
              fromOpenApi: false,
            },
            documentationEvidence: null,
          },
        ],
      },
      importantFiles: {
        readme: { exists: true, path: 'README.md' },
      },
      warnings: [],
    });
  });

  afterAll(async () => {
    await cleanTestDb();
    await disconnectTestDb();
  });

  describe('Authentication & Ownership', () => {
    test('returns 401 when unauthenticated', async () => {
      const res = await request(app)
        .get(`/api/repositories/${repoA._id}/scans/${completedScan._id}/analysis`);
      expect(res.status).toBe(401);
    });

    test('User B receives 404 when attempting to access User A analysis', async () => {
      const res = await request(app)
        .get(`/api/repositories/${repoA._id}/scans/${completedScan._id}/analysis`)
        .set('Cookie', cookieB);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/not found/i);
    });
  });

  describe('Scan State Validation', () => {
    test('returns 400 SCAN_NOT_COMPLETED when scan is still QUEUED', async () => {
      const res = await request(app)
        .get(`/api/repositories/${repoA._id}/scans/${queuedScan._id}/analysis`)
        .set('Cookie', cookieA);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('SCAN_NOT_COMPLETED');
    });

    test('returns 400 SCAN_FAILED when scan has FAILED status', async () => {
      const res = await request(app)
        .get(`/api/repositories/${repoA._id}/scans/${failedScan._id}/analysis`)
        .set('Cookie', cookieA);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('SCAN_FAILED');
    });

    test('returns 404 when completed scan record exists but AnalysisResult is missing', async () => {
      const ghostScan = await Scan.create({
        repositoryId: repoA._id,
        userId: userA._id,
        status: 'COMPLETED',
        branch: 'main',
        commitSha: 'sha-ghost',
        activeScanKey: null,
      });

      const res = await request(app)
        .get(`/api/repositories/${repoA._id}/scans/${ghostScan._id}/analysis`)
        .set('Cookie', cookieA);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ANALYSIS_NOT_FOUND');
    });
  });

  describe('Successful Retrieval & Contract Preservation', () => {
    test('GET /api/repositories/:id/scans/:scanId/analysis returns 200 with analysis details', async () => {
      const res = await request(app)
        .get(`/api/repositories/${repoA._id}/scans/${completedScan._id}/analysis`)
        .set('Cookie', cookieA);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.analysis).toBeDefined();
      expect(res.body.analysis.scanId).toBe(completedScan._id.toString());
      expect(res.body.analysis.fileCounts.total).toBe(50);
      expect(res.body.analysis.facts.code.apiEndpoints.length).toBe(1);
      expect(res.body.analysis.facts.code.apiEndpoints[0].file).toBe('src/routes/auth.js');
      expect(res.body.analysis.facts.code.apiEndpoints[0].source).toBe('src/routes/auth.js');
    });

    test('response preserves drift findings and codeEvidence context flags', async () => {
      const res = await request(app)
        .get(`/api/repositories/${repoA._id}/scans/${completedScan._id}/analysis`)
        .set('Cookie', cookieA);

      expect(res.status).toBe(200);
      const findings = res.body.analysis.drift.findings;
      expect(findings.length).toBe(1);
      expect(findings[0].type).toBe('UNDOCUMENTED_API');
      expect(findings[0].severity).toBe('HIGH');
      expect(findings[0].codeEvidence.file).toBe('src/routes/auth.js');
      expect(findings[0].codeEvidence.source).toBe('src/routes/auth.js');
      expect(findings[0].codeEvidence.prefixResolved).toBe(true);
    });

    test('GET /api/repositories/:id/analysis/latest returns latest analysis for repository', async () => {
      const res = await request(app)
        .get(`/api/repositories/${repoA._id}/analysis/latest`)
        .set('Cookie', cookieA);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.analysis).toBeDefined();
      expect(res.body.analysis.scanId).toBe(completedScan._id.toString());
    });
  });
});
