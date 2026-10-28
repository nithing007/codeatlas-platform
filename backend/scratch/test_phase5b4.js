/**
 * Phase 5B.4 Protected Analysis REST APIs Test Suite
 *
 * Validates:
 * 1. Unauthenticated requests (401)
 * 2. Invalid repository / scan ID formats (404)
 * 3. Non-existent repository / scan lookups (404)
 * 4. Cross-user isolation on repository level (404)
 * 5. Repository with no completed analysis returns consistent 404 (code: ANALYSIS_NOT_FOUND)
 * 6. QUEUED scan analysis retrieval returns 400 (code: SCAN_NOT_COMPLETED)
 * 7. RUNNING scan analysis retrieval returns 400 (code: SCAN_NOT_COMPLETED)
 * 8. FAILED scan analysis retrieval returns 400 (code: SCAN_FAILED)
 * 9. COMPLETED scan with missing AnalysisResult document returns 404 (code: ANALYSIS_NOT_FOUND)
 * 10. Cross-repository scan access (scan belonging to Repo B requested via Repo A) returns 404
 * 11. Cross-user scan access (scan belonging to User B requested via User A's repo) returns 404
 * 12. Successful retrieval of latest completed analysis (returns newest completed scan)
 * 13. Successful retrieval by repository ID and scan ID
 * 14. Full response contract verification (all required fields present)
 * 15. Security verification (no raw files[], no env values, no internal tokens, no stack traces)
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Repository = require('../src/models/Repository');
const Scan = require('../src/models/Scan');
const AnalysisResult = require('../src/models/AnalysisResult');
const { generateToken } = require('../src/services/jwtService');
const config = require('../src/config');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  [PASS] ${message}`);
  } else {
    failedTests++;
    console.error(`  [FAIL] ${message}`);
    failures.push(message);
  }
}

async function runPhase5B4Tests() {
  console.log('=============================================================');
  console.log('  Phase 5B.4: Protected Analysis REST APIs Test Suite');
  console.log('=============================================================\n');

  await mongoose.connect(config.mongodbUri);
  const BASE_URL = `http://localhost:${config.port}`;

  // Track created IDs for teardown
  const createdUserIds = [];
  const createdRepoIds = [];
  const createdScanIds = [];
  const createdResultIds = [];

  try {
    // -------------------------------------------------------------------------
    // Setup test users and tokens
    // -------------------------------------------------------------------------
    const userA = await User.create({
      email: `test.user.a.${Date.now()}@example.com`,
      authProvider: 'email',
      role: 'user',
    });
    createdUserIds.push(userA._id);

    const userB = await User.create({
      email: `test.user.b.${Date.now()}@example.com`,
      authProvider: 'email',
      role: 'user',
    });
    createdUserIds.push(userB._id);

    const tokenA = generateToken({ id: userA._id, role: userA.role });
    const tokenB = generateToken({ id: userB._id, role: userB.role });

    const authHeadersA = {
      'Content-Type': 'application/json',
      Cookie: `${config.authCookieName}=${tokenA}`,
    };

    const authHeadersB = {
      'Content-Type': 'application/json',
      Cookie: `${config.authCookieName}=${tokenB}`,
    };

    // -------------------------------------------------------------------------
    // Setup test repositories
    // -------------------------------------------------------------------------
    const repoA1 = await Repository.create({
      userId: userA._id,
      githubRepositoryId: `gh-${Date.now()}-1`,
      name: 'repo-a1',
      fullName: 'testuser-a/repo-a1',
      owner: 'testuser-a',
      htmlUrl: 'https://github.com/testuser-a/repo-a1',
      defaultBranch: 'main',
    });
    createdRepoIds.push(repoA1._id);

    const repoA2 = await Repository.create({
      userId: userA._id,
      githubRepositoryId: `gh-${Date.now()}-2`,
      name: 'repo-a2',
      fullName: 'testuser-a/repo-a2',
      owner: 'testuser-a',
      htmlUrl: 'https://github.com/testuser-a/repo-a2',
      defaultBranch: 'main',
    });
    createdRepoIds.push(repoA2._id);

    const repoB = await Repository.create({
      userId: userB._id,
      githubRepositoryId: `gh-${Date.now()}-3`,
      name: 'repo-b',
      fullName: 'testuser-b/repo-b',
      owner: 'testuser-b',
      htmlUrl: 'https://github.com/testuser-b/repo-b',
      defaultBranch: 'main',
    });
    createdRepoIds.push(repoB._id);

    // =========================================================================
    // SECTION 1: Unauthenticated Requests (401)
    // =========================================================================
    console.log('--- SECTION 1: Unauthenticated Requests ---');

    {
      const res = await fetch(`${BASE_URL}/api/repositories/${repoA1._id}/analysis/latest`);
      const body = await res.json();
      assert(res.status === 401, 'TEST 1: GET latest analysis without auth returns 401');
      assert(body.success === false, 'TEST 2: Body indicates success: false');
    }

    {
      const dummyScanId = new mongoose.Types.ObjectId();
      const res = await fetch(`${BASE_URL}/api/repositories/${repoA1._id}/scans/${dummyScanId}/analysis`);
      const body = await res.json();
      assert(res.status === 401, 'TEST 3: GET scan analysis without auth returns 401');
      assert(body.success === false, 'TEST 4: Body indicates success: false');
    }

    // =========================================================================
    // SECTION 2: Invalid IDs (404)
    // =========================================================================
    console.log('\n--- SECTION 2: Invalid MongoDB IDs ---');

    {
      const res = await fetch(`${BASE_URL}/api/repositories/invalid-repo-id/analysis/latest`, {
        headers: authHeadersA,
      });
      const body = await res.json();
      assert(res.status === 404, 'TEST 5: Invalid repository ID on latest returns 404');
      assert(body.error === 'Repository not found.', 'TEST 6: Error message is "Repository not found."');
    }

    {
      const res = await fetch(`${BASE_URL}/api/repositories/invalid-repo-id/scans/${new mongoose.Types.ObjectId()}/analysis`, {
        headers: authHeadersA,
      });
      const body = await res.json();
      assert(res.status === 404, 'TEST 7: Invalid repository ID on scan analysis returns 404');
    }

    {
      const res = await fetch(`${BASE_URL}/api/repositories/${repoA1._id}/scans/invalid-scan-id/analysis`, {
        headers: authHeadersA,
      });
      const body = await res.json();
      assert(res.status === 404, 'TEST 8: Invalid scan ID returns 404');
      assert(body.error === 'Scan not found.', 'TEST 9: Error message is "Scan not found."');
    }

    // =========================================================================
    // SECTION 3: Non-existent Resources (404)
    // =========================================================================
    console.log('\n--- SECTION 3: Non-existent Repository / Scan ---');

    {
      const nonExistentRepoId = new mongoose.Types.ObjectId();
      const res = await fetch(`${BASE_URL}/api/repositories/${nonExistentRepoId}/analysis/latest`, {
        headers: authHeadersA,
      });
      const body = await res.json();
      assert(res.status === 404, 'TEST 10: Non-existent repository on latest returns 404');
      assert(body.error === 'Repository not found.', 'TEST 11: Error is "Repository not found."');
    }

    {
      const nonExistentScanId = new mongoose.Types.ObjectId();
      const res = await fetch(`${BASE_URL}/api/repositories/${repoA1._id}/scans/${nonExistentScanId}/analysis`, {
        headers: authHeadersA,
      });
      const body = await res.json();
      assert(res.status === 404, 'TEST 12: Non-existent scan ID returns 404');
      assert(body.error === 'Scan not found.', 'TEST 13: Error is "Scan not found."');
    }

    // =========================================================================
    // SECTION 4: Cross-User Ownership Isolation (404)
    // =========================================================================
    console.log('\n--- SECTION 4: Cross-User Ownership Isolation ---');

    {
      // User A attempts to access User B's repository latest analysis
      const res = await fetch(`${BASE_URL}/api/repositories/${repoB._id}/analysis/latest`, {
        headers: authHeadersA,
      });
      const body = await res.json();
      assert(res.status === 404, 'TEST 14: User A accessing User B repository latest returns 404');
      assert(body.error === 'Repository not found.', 'TEST 15: Cross-user repository error is "Repository not found."');
    }

    {
      // User A attempts to access User B's scan analysis via User B's repository
      const dummyScanId = new mongoose.Types.ObjectId();
      const res = await fetch(`${BASE_URL}/api/repositories/${repoB._id}/scans/${dummyScanId}/analysis`, {
        headers: authHeadersA,
      });
      const body = await res.json();
      assert(res.status === 404, 'TEST 16: User A accessing User B scan analysis returns 404');
    }

    // =========================================================================
    // SECTION 5: Repository with No Completed Analysis (404)
    // =========================================================================
    console.log('\n--- SECTION 5: No Completed Analysis Available ---');

    {
      // Repo A1 has no scans at all
      const res = await fetch(`${BASE_URL}/api/repositories/${repoA1._id}/analysis/latest`, {
        headers: authHeadersA,
      });
      const body = await res.json();
      assert(res.status === 404, 'TEST 17: Repository with 0 scans returns 404');
      const errCode = body.error && (body.error.code || body.error);
      assert(errCode === 'ANALYSIS_NOT_FOUND', 'TEST 18: Error code is ANALYSIS_NOT_FOUND');
    }

    // =========================================================================
    // SECTION 6: QUEUED, RUNNING, and FAILED Scans (400)
    // =========================================================================
    console.log('\n--- SECTION 6: QUEUED, RUNNING, and FAILED Scans ---');

    // Create a QUEUED scan
    const scanQueued = await Scan.create({
      repositoryId: repoA1._id,
      userId: userA._id,
      status: 'QUEUED',
      branch: 'main',
      commitSha: 'sha-queued-1',
    });
    createdScanIds.push(scanQueued._id);

    {
      // Latest analysis when only QUEUED scans exist
      const res = await fetch(`${BASE_URL}/api/repositories/${repoA1._id}/analysis/latest`, {
        headers: authHeadersA,
      });
      const body = await res.json();
      assert(res.status === 404, 'TEST 19: Latest returns 404 when only QUEUED scans exist');
      const errCode = body.error && (body.error.code || body.error);
      assert(errCode === 'ANALYSIS_NOT_FOUND', 'TEST 20: Error code is ANALYSIS_NOT_FOUND for QUEUED-only repo');
    }

    {
      // Directly requesting QUEUED scan analysis
      const res = await fetch(`${BASE_URL}/api/repositories/${repoA1._id}/scans/${scanQueued._id}/analysis`, {
        headers: authHeadersA,
      });
      const body = await res.json();
      assert(res.status === 400, 'TEST 21: QUEUED scan analysis returns 400 Bad Request');
      const errCode = body.error && (body.error.code || body.error);
      assert(errCode === 'SCAN_NOT_COMPLETED', 'TEST 22: QUEUED scan error code is SCAN_NOT_COMPLETED');
      const errMsg = body.error && (body.error.message || body.error);
      assert(errMsg.includes('QUEUED'), 'TEST 23: QUEUED scan error message mentions QUEUED');
    }

    // Create a RUNNING scan
    const scanRunning = await Scan.create({
      repositoryId: repoA1._id,
      userId: userA._id,
      status: 'RUNNING',
      branch: 'main',
      commitSha: 'sha-running-1',
      startedAt: new Date(),
    });
    createdScanIds.push(scanRunning._id);

    {
      // Directly requesting RUNNING scan analysis
      const res = await fetch(`${BASE_URL}/api/repositories/${repoA1._id}/scans/${scanRunning._id}/analysis`, {
        headers: authHeadersA,
      });
      const body = await res.json();
      assert(res.status === 400, 'TEST 24: RUNNING scan analysis returns 400 Bad Request');
      const errCode = body.error && (body.error.code || body.error);
      assert(errCode === 'SCAN_NOT_COMPLETED', 'TEST 25: RUNNING scan error code is SCAN_NOT_COMPLETED');
      const errMsg = body.error && (body.error.message || body.error);
      assert(errMsg.includes('RUNNING'), 'TEST 26: RUNNING scan error message mentions RUNNING');
    }

    // Create a FAILED scan
    const scanFailed = await Scan.create({
      repositoryId: repoA1._id,
      userId: userA._id,
      status: 'FAILED',
      branch: 'main',
      commitSha: 'sha-failed-1',
      startedAt: new Date(Date.now() - 60000),
      completedAt: new Date(),
      error: 'Simulated analyzer failure',
    });
    createdScanIds.push(scanFailed._id);

    {
      // Directly requesting FAILED scan analysis
      const res = await fetch(`${BASE_URL}/api/repositories/${repoA1._id}/scans/${scanFailed._id}/analysis`, {
        headers: authHeadersA,
      });
      const body = await res.json();
      assert(res.status === 400, 'TEST 27: FAILED scan analysis returns 400 Bad Request');
      const errCode = body.error && (body.error.code || body.error);
      assert(errCode === 'SCAN_FAILED', 'TEST 28: FAILED scan error code is SCAN_FAILED');
      const errMsg = body.error && (body.error.message || body.error);
      assert(errMsg.toLowerCase().includes('failed'), 'TEST 29: FAILED scan error message mentions failed');
    }

    // =========================================================================
    // SECTION 7: COMPLETED Scan with Missing AnalysisResult Document (404)
    // =========================================================================
    console.log('\n--- SECTION 7: COMPLETED Scan with Missing Result ---');

    const scanCompletedNoResult = await Scan.create({
      repositoryId: repoA1._id,
      userId: userA._id,
      status: 'COMPLETED',
      branch: 'main',
      commitSha: 'sha-completed-no-result',
      startedAt: new Date(Date.now() - 120000),
      completedAt: new Date(Date.now() - 60000),
      filesScanned: 10,
      findingsCount: 0,
    });
    createdScanIds.push(scanCompletedNoResult._id);

    {
      const res = await fetch(`${BASE_URL}/api/repositories/${repoA1._id}/scans/${scanCompletedNoResult._id}/analysis`, {
        headers: authHeadersA,
      });
      const body = await res.json();
      assert(res.status === 404, 'TEST 30: COMPLETED scan with missing AnalysisResult returns 404');
      const errCode = body.error && (body.error.code || body.error);
      assert(errCode === 'ANALYSIS_NOT_FOUND', 'TEST 31: Error code is ANALYSIS_NOT_FOUND');
    }

    // =========================================================================
    // SECTION 8: Cross-Repository Scan Isolation
    // =========================================================================
    console.log('\n--- SECTION 8: Cross-Repository Scan Isolation ---');

    // Create a completed scan for Repo A2
    const scanA2 = await Scan.create({
      repositoryId: repoA2._id,
      userId: userA._id,
      status: 'COMPLETED',
      branch: 'main',
      commitSha: 'sha-repo-a2',
      startedAt: new Date(Date.now() - 30000),
      completedAt: new Date(),
    });
    createdScanIds.push(scanA2._id);

    const resultA2 = await AnalysisResult.create({
      scanId: scanA2._id,
      repositoryId: repoA2._id,
      userId: userA._id,
      commitSha: scanA2.commitSha,
      branch: scanA2.branch,
      analyzerVersion: '1.0.0',
      fileCounts: { total: 5, source: 4, documentation: 1, configuration: 0, infrastructure: 0, other: 0 },
      facts: {
        code: { apiEndpoints: [], envVars: [], dependencies: [], scripts: [] },
        documentation: { apiEndpoints: [], envVars: [] },
      },
      drift: { summary: { total: 0, high: 0, medium: 0, low: 0 }, findings: [] },
      importantFiles: { readme: 'README.md' },
      warnings: [],
    });
    createdResultIds.push(resultA2._id);

    {
      // User A attempts to request scanA2 (which belongs to Repo A2) through Repo A1 URL
      const res = await fetch(`${BASE_URL}/api/repositories/${repoA1._id}/scans/${scanA2._id}/analysis`, {
        headers: authHeadersA,
      });
      const body = await res.json();
      assert(res.status === 404, 'TEST 32: Scan ID belonging to different repo returns 404');
      assert(body.error === 'Scan not found.', 'TEST 33: Error message is "Scan not found."');
    }

    // Create a completed scan for User B / Repo B
    const scanB = await Scan.create({
      repositoryId: repoB._id,
      userId: userB._id,
      status: 'COMPLETED',
      branch: 'main',
      commitSha: 'sha-repo-b',
      startedAt: new Date(Date.now() - 30000),
      completedAt: new Date(),
    });
    createdScanIds.push(scanB._id);

    const resultB = await AnalysisResult.create({
      scanId: scanB._id,
      repositoryId: repoB._id,
      userId: userB._id,
      commitSha: scanB.commitSha,
      branch: scanB.branch,
      analyzerVersion: '1.0.0',
      fileCounts: { total: 10 },
      drift: { summary: { total: 0, high: 0, medium: 0, low: 0 }, findings: [] },
    });
    createdResultIds.push(resultB._id);

    {
      // User A attempts to access scanB through User A's Repo A1 URL
      const res = await fetch(`${BASE_URL}/api/repositories/${repoA1._id}/scans/${scanB._id}/analysis`, {
        headers: authHeadersA,
      });
      const body = await res.json();
      assert(res.status === 404, 'TEST 34: User B scan ID requested through User A repo returns 404');
      assert(body.error === 'Scan not found.', 'TEST 35: Error message is "Scan not found."');
    }

    {
      // User A attempts to access scanB through User B's Repo B URL
      const res = await fetch(`${BASE_URL}/api/repositories/${repoB._id}/scans/${scanB._id}/analysis`, {
        headers: authHeadersA,
      });
      const body = await res.json();
      assert(res.status === 404, 'TEST 36: User A accessing User B scan via User B repo returns 404 (repo not owned)');
      assert(body.error === 'Repository not found.', 'TEST 37: Error message is "Repository not found."');
    }

    // =========================================================================
    // SECTION 9: Successful Retrieval of Latest Analysis
    // =========================================================================
    console.log('\n--- SECTION 9: Successful Latest Analysis Retrieval ---');

    // Create completed Scan 1 (older) for Repo A1
    const scan1Time = new Date(Date.now() - 100000);
    const scan1 = await Scan.create({
      repositoryId: repoA1._id,
      userId: userA._id,
      status: 'COMPLETED',
      branch: 'main',
      commitSha: 'sha-scan-1',
      startedAt: new Date(scan1Time.getTime() - 20000),
      completedAt: scan1Time,
      filesScanned: 15,
      findingsCount: 1,
    });
    createdScanIds.push(scan1._id);

    const result1 = await AnalysisResult.create({
      scanId: scan1._id,
      repositoryId: repoA1._id,
      userId: userA._id,
      commitSha: scan1.commitSha,
      branch: scan1.branch,
      analyzerVersion: '1.0.0',
      fileCounts: { total: 15, source: 12, documentation: 2, configuration: 1, infrastructure: 0, other: 0 },
      facts: {
        code: {
          apiEndpoints: [{ method: 'GET', path: '/api/v1/items', file: 'src/routes.js', line: 10 }],
          envVars: [{ name: 'PORT', file: 'src/config.js', line: 5 }],
          dependencies: [{ name: 'express', version: '^4.18.2', type: 'production' }],
          scripts: [{ name: 'start', command: 'node server.js' }],
        },
        documentation: {
          apiEndpoints: [{ method: 'GET', path: '/api/v1/items', file: 'README.md', line: 40 }],
          envVars: [{ name: 'PORT', file: 'README.md', line: 20 }],
        },
      },
      drift: {
        summary: { total: 1, high: 0, medium: 1, low: 0 },
        findings: [
          {
            type: 'UNDOCUMENTED_API',
            severity: 'MEDIUM',
            title: 'Undocumented API endpoint',
            message: 'Endpoint GET /api/v1/items is not documented in README.',
            resource: { method: 'GET', path: '/api/v1/items' },
            codeEvidence: { file: 'src/routes.js', line: 10, method: 'GET', path: '/api/v1/items' },
          },
        ],
      },
      importantFiles: { readme: 'README.md', packageJson: 'package.json' },
      warnings: ['Scan 1 warning note'],
    });
    createdResultIds.push(result1._id);

    // Create completed Scan 2 (newer) for Repo A1
    const scan2Time = new Date(Date.now() - 10000);
    const scan2 = await Scan.create({
      repositoryId: repoA1._id,
      userId: userA._id,
      status: 'COMPLETED',
      branch: 'main',
      commitSha: 'sha-scan-2',
      startedAt: new Date(scan2Time.getTime() - 20000),
      completedAt: scan2Time,
      filesScanned: 20,
      findingsCount: 2,
    });
    createdScanIds.push(scan2._id);

    const result2 = await AnalysisResult.create({
      scanId: scan2._id,
      repositoryId: repoA1._id,
      userId: userA._id,
      commitSha: scan2.commitSha,
      branch: scan2.branch,
      analyzerVersion: '1.0.0',
      fileCounts: { total: 20, source: 15, documentation: 3, configuration: 2, infrastructure: 0, other: 0 },
      facts: {
        code: {
          apiEndpoints: [
            { method: 'GET', path: '/api/v2/items', file: 'src/routes.js', line: 12 },
            { method: 'POST', path: '/api/v2/items', file: 'src/routes.js', line: 25 },
          ],
          envVars: [
            { name: 'PORT', file: 'src/config.js', line: 5 },
            { name: 'DATABASE_URL', file: 'src/config.js', line: 8 },
          ],
          dependencies: [
            { name: 'express', version: '^4.18.2', type: 'production' },
            { name: 'jest', version: '^29.0.0', type: 'development' },
          ],
          scripts: [
            { name: 'start', command: 'node server.js' },
            { name: 'test', command: 'jest' },
          ],
        },
        documentation: {
          apiEndpoints: [
            { method: 'GET', path: '/api/v2/items', file: 'README.md', line: 45 },
          ],
          envVars: [
            { name: 'PORT', file: 'README.md', line: 22 },
          ],
        },
      },
      drift: {
        summary: { total: 2, high: 1, medium: 1, low: 0 },
        findings: [
          {
            type: 'UNDOCUMENTED_API',
            severity: 'HIGH',
            title: 'Undocumented POST endpoint',
            message: 'Endpoint POST /api/v2/items is missing from documentation.',
            resource: { method: 'POST', path: '/api/v2/items' },
            codeEvidence: { file: 'src/routes.js', line: 25, method: 'POST', path: '/api/v2/items' },
          },
          {
            type: 'UNDOCUMENTED_ENVIRONMENT_VARIABLE',
            severity: 'MEDIUM',
            title: 'Undocumented environment variable DATABASE_URL',
            message: 'DATABASE_URL is used in code but not documented.',
            resource: 'DATABASE_URL',
            codeEvidence: { file: 'src/config.js', line: 8, name: 'DATABASE_URL' },
          },
        ],
      },
      importantFiles: { readme: 'README.md', packageJson: 'package.json', dockerfile: 'Dockerfile' },
      warnings: [],
    });
    createdResultIds.push(result2._id);

    {
      // Retrieve latest analysis
      const res = await fetch(`${BASE_URL}/api/repositories/${repoA1._id}/analysis/latest`, {
        headers: authHeadersA,
      });
      const body = await res.json();
      assert(res.status === 200, 'TEST 38: GET latest analysis returns 200 OK');
      assert(body.success === true, 'TEST 39: Response has success: true');
      assert(body.analysis !== undefined, 'TEST 40: Response contains analysis object');
      assert(body.analysis.scanId === scan2._id.toString(), 'TEST 41: Latest analysis returns newer Scan 2 (not Scan 1)');
      assert(body.analysis.commitSha === 'sha-scan-2', 'TEST 42: Commit SHA matches Scan 2');
      assert(body.analysis.drift.summary.total === 2, 'TEST 43: Drift summary total is 2');
    }

    // =========================================================================
    // SECTION 10: Successful Retrieval by Scan ID
    // =========================================================================
    console.log('\n--- SECTION 10: Successful Retrieval by Scan ID ---');

    {
      // Retrieve Scan 1 (older scan) explicitly
      const res = await fetch(`${BASE_URL}/api/repositories/${repoA1._id}/scans/${scan1._id}/analysis`, {
        headers: authHeadersA,
      });
      const body = await res.json();
      assert(res.status === 200, 'TEST 44: GET scan1 analysis returns 200 OK');
      assert(body.success === true, 'TEST 45: Response has success: true');
      assert(body.analysis.scanId === scan1._id.toString(), 'TEST 46: Returns Scan 1 ID');
      assert(body.analysis.commitSha === 'sha-scan-1', 'TEST 47: Returns Scan 1 commit SHA');
      assert(body.analysis.drift.summary.total === 1, 'TEST 48: Drift total is 1 for Scan 1');
    }

    {
      // Retrieve Scan 2 (newer scan) explicitly
      const res = await fetch(`${BASE_URL}/api/repositories/${repoA1._id}/scans/${scan2._id}/analysis`, {
        headers: authHeadersA,
      });
      const body = await res.json();
      assert(res.status === 200, 'TEST 49: GET scan2 analysis returns 200 OK');
      assert(body.analysis.scanId === scan2._id.toString(), 'TEST 50: Returns Scan 2 ID');
      assert(body.analysis.drift.summary.total === 2, 'TEST 51: Drift total is 2 for Scan 2');
    }

    // =========================================================================
    // SECTION 11: Response Contract & Schema Verification
    // =========================================================================
    console.log('\n--- SECTION 11: Response Contract Verification ---');

    {
      const res = await fetch(`${BASE_URL}/api/repositories/${repoA1._id}/scans/${scan2._id}/analysis`, {
        headers: authHeadersA,
      });
      const body = await res.json();
      const a = body.analysis;

      assert(typeof a.scanId === 'string' && a.scanId.length > 0, 'TEST 52: scanId is present string');
      assert(typeof a.repositoryId === 'string' && a.repositoryId.length > 0, 'TEST 53: repositoryId is present string');
      assert(a.branch === 'main', 'TEST 54: branch is present string');
      assert(a.commitSha === 'sha-scan-2', 'TEST 55: commitSha is present string');
      assert(a.analyzerVersion === '1.0.0', 'TEST 56: analyzerVersion is present string');
      assert(typeof a.createdAt === 'string', 'TEST 57: createdAt timestamp is present');
      assert(typeof a.fileCounts === 'object' && a.fileCounts.total === 20, 'TEST 58: fileCounts is present');
      assert(Array.isArray(a.facts.code.apiEndpoints) && a.facts.code.apiEndpoints.length === 2, 'TEST 59: facts.code.apiEndpoints is array');
      assert(Array.isArray(a.facts.code.envVars) && a.facts.code.envVars.length === 2, 'TEST 60: facts.code.envVars is array');
      assert(Array.isArray(a.facts.code.dependencies) && a.facts.code.dependencies.length === 2, 'TEST 61: facts.code.dependencies is array');
      assert(Array.isArray(a.facts.code.scripts) && a.facts.code.scripts.length === 2, 'TEST 62: facts.code.scripts is array');
      assert(Array.isArray(a.facts.documentation.apiEndpoints) && a.facts.documentation.apiEndpoints.length === 1, 'TEST 63: facts.documentation.apiEndpoints is array');
      assert(Array.isArray(a.facts.documentation.envVars) && a.facts.documentation.envVars.length === 1, 'TEST 64: facts.documentation.envVars is array');
      assert(typeof a.drift.summary === 'object' && a.drift.summary.high === 1, 'TEST 65: drift.summary breakdown present');
      assert(Array.isArray(a.drift.findings) && a.drift.findings.length === 2, 'TEST 66: drift.findings array present');
      assert(typeof a.importantFiles === 'object' && a.importantFiles.readme === 'README.md', 'TEST 67: importantFiles present');
      assert(Array.isArray(a.warnings), 'TEST 68: warnings array present');
    }

    // =========================================================================
    // SECTION 12: Security & Information Disclosure Audit
    // =========================================================================
    console.log('\n--- SECTION 12: Security & Information Disclosure Audit ---');

    {
      const res = await fetch(`${BASE_URL}/api/repositories/${repoA1._id}/scans/${scan2._id}/analysis`, {
        headers: authHeadersA,
      });
      const rawBody = await res.text();
      const body = JSON.parse(rawBody);
      const a = body.analysis;

      // Invariant 1: No raw files[] inventory
      assert(a.files === undefined, 'TEST 69: No files[] inventory at analysis root');
      assert(rawBody.indexOf('"files":') === -1, 'TEST 70: Raw JSON does not contain "files":');

      // Invariant 2: Environment variables are stored by NAME only, never values
      const envVars = a.facts.code.envVars;
      const hasValueProp = envVars.some((ev) => ev.value !== undefined || ev.val !== undefined);
      assert(!hasValueProp, 'TEST 71: Environment variables do not have value properties');

      // Invariant 3: No internal secrets or tokens in output
      assert(rawBody.indexOf(config.jwtSecret) === -1, 'TEST 72: JWT secret not in response');
      if (config.analyzerInternalToken) {
        assert(rawBody.indexOf(config.analyzerInternalToken) === -1, 'TEST 73: Analyzer internal token not in response');
      } else {
        assert(true, 'TEST 73: (Analyzer internal token empty, invariant holds)');
      }

      // Invariant 4: No stack traces or internals
      assert(rawBody.indexOf('node:internal') === -1, 'TEST 74: Response contains no node:internal stack traces');
      assert(rawBody.indexOf('AnalysisResult.js') === -1, 'TEST 75: Response contains no source code stack traces');
      assert(a.__v === undefined, 'TEST 76: Mongoose __v internal version key stripped');
    }

  } finally {
    // -------------------------------------------------------------------------
    // Cleanup test records
    // -------------------------------------------------------------------------
    console.log('\n--- Cleaning up test records ---');
    if (createdResultIds.length > 0) {
      await AnalysisResult.deleteMany({ _id: { $in: createdResultIds } });
    }
    if (createdScanIds.length > 0) {
      await Scan.deleteMany({ _id: { $in: createdScanIds } });
    }
    if (createdRepoIds.length > 0) {
      await Repository.deleteMany({ _id: { $in: createdRepoIds } });
    }
    if (createdUserIds.length > 0) {
      await User.deleteMany({ _id: { $in: createdUserIds } });
    }
    console.log('Cleanup completed.');
    await mongoose.disconnect();
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n=============================================================');
  console.log(`  Phase 5B.4 Test Summary: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
  console.log('=============================================================\n');

  if (failedTests > 0) {
    console.error('Failed assertions:');
    failures.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  }
}

runPhase5B4Tests().catch((err) => {
  console.error('\nFatal error in Phase 5B.4 test runner:', err);
  process.exit(1);
});
