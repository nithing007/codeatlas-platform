/**
 * CodeAtlas Phase 5B.3 — Real End-to-End Validation Script
 *
 * Runs a complete real-world validation of the asynchronous scan lifecycle:
 * - Real Backend HTTP service (port 5000)
 * - Real Analyzer HTTP service (port 6000)
 * - Real GitHub API (hagopj13/node-express-boilerplate)
 * - Real MongoDB persistence
 *
 * Checks:
 * 1. Health checks on both services
 * 2. Scan creation: immediate 201 response with status QUEUED
 * 3. Asynchronous execution: transitions QUEUED -> RUNNING -> COMPLETED
 * 4. GitHub SHA resolution: 40-char hex Git commit SHA
 * 5. MongoDB persistence: Scan + single AnalysisResult with strict structural & security invariants
 * 6. Concurrency / 409 duplicate active scan prevention
 * 7. Authorization & ownership isolation (cross-user 404, unauthenticated 401)
 * 8. Cleanup of ONLY validation-created records
 *
 * Run: node scratch/validate_phase5b3_real_e2e.js
 */

'use strict';

require('dotenv').config();

const mongoose = require('mongoose');
const User = require('../src/models/User');
const Repository = require('../src/models/Repository');
const Scan = require('../src/models/Scan');
const AnalysisResult = require('../src/models/AnalysisResult');
const { generateToken } = require('../src/services/jwtService');

const BACKEND_URL = 'http://localhost:5000';
const ANALYZER_URL = 'http://localhost:6001';

let passed = 0;
let failed = 0;
const failures = [];
const logs = [];

function log(msg) {
  console.log(msg);
  logs.push(msg);
}

function assert(condition, name, detail = '') {
  if (condition) {
    log(`  [PASS] ${name}`);
    passed++;
  } else {
    const msg = detail ? `${name} — ${detail}` : name;
    log(`  [FAIL] ${msg}`);
    failures.push(msg);
    failed++;
  }
}

const http = require('http');

function httpFetch(targetUrl, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const req = http.request(reqOptions, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(raw);
        } catch {
          json = raw;
        }
        resolve({ status: res.statusCode, headers: res.headers, data: json });
      });
    });

    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function runValidation() {
  log('=============================================================');
  log('  CodeAtlas — Phase 5B.3 Real End-to-End Validation');
  log('=============================================================\n');

  // Connect to MongoDB
  await mongoose.connect(process.env.MONGODB_URI);
  log('Connected to MongoDB.\n');

  // Load existing test users and repo
  const userA = await User.findById('6ae0c192681e1fe909bd4ea3');
  const userB = await User.findById('6aa4181c94b0c74435bde5b7');
  const repoA = await Repository.findById('6ae0c192681e1fe909bd4ea5');

  if (!userA || !userB || !repoA) {
    throw new Error('Prerequisite test fixtures not found in database.');
  }

  log(`Test User A ID: ${userA._id}`);
  log(`Test User B ID: ${userB._id}`);
  log(`Test Repository: ${repoA.fullName} (ID: ${repoA._id}, Branch: ${repoA.defaultBranch})\n`);

  const tokenA = generateToken({ id: userA._id, role: userA.role || 'user' });
  const tokenB = generateToken({ id: userB._id, role: userB.role || 'user' });

  const authHeadersA = {
    'Content-Type': 'application/json',
    'Cookie': `codeatlas_auth=${tokenA}`,
  };

  const authHeadersB = {
    'Content-Type': 'application/json',
    'Cookie': `codeatlas_auth=${tokenB}`,
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Step 1: Health Checks
  // ─────────────────────────────────────────────────────────────────────────
  log('--- Step 1: Services & Health Checks ---');

  const backendHealth = await httpFetch(`${BACKEND_URL}/api/health`);
  assert(backendHealth.status === 200, 'Backend health check returns 200');
  assert(backendHealth.data.database === 'connected', 'Backend reports database: connected');

  const analyzerHealth = await httpFetch(`${ANALYZER_URL}/api/health`);
  assert(analyzerHealth.status === 200, 'Analyzer health check returns 200');
  assert(analyzerHealth.data.status === 'ok' && analyzerHealth.data.service === 'analyzer',
    'Analyzer reports status: ok, service: analyzer');

  // ─────────────────────────────────────────────────────────────────────────
  // Step 2: Real Scan Initiation (Asynchronous Non-Blocking HTTP Request)
  // ─────────────────────────────────────────────────────────────────────────
  log('\n--- Step 2: Real Scan Initiation via Backend API ---');

  const createStart = Date.now();
  const createRes = await httpFetch(`${BACKEND_URL}/api/repositories/${repoA._id}/scans`, {
    method: 'POST',
    headers: authHeadersA,
    body: JSON.stringify({}),
  });
  const createDuration = Date.now() - createStart;

  assert(createRes.status === 201, 'POST /api/repositories/:id/scans returns HTTP 201');
  assert(createDuration < 3000, `Scan creation response is immediate (${createDuration}ms < 3000ms)`);

  const initialScan = createRes.data && createRes.data.scan;
  assert(Boolean(initialScan), 'Response contains created scan object');
  assert(initialScan.status === 'QUEUED', 'Initial scan status is QUEUED');
  assert(initialScan.branch === repoA.defaultBranch, `Branch matches repository default branch (${repoA.defaultBranch})`);
  assert(/^[0-9a-f]{40}$/i.test(initialScan.commitSha),
    `Commit SHA resolved from GitHub is 40-char hex (${initialScan.commitSha})`);
  assert(initialScan.filesScanned === 0, 'Initial filesScanned is 0');
  assert(initialScan.findingsCount === 0, 'Initial findingsCount is 0');

  const validationScanId = initialScan._id;
  log(`Created Scan ID: ${validationScanId}`);

  // ─────────────────────────────────────────────────────────────────────────
  // Step 3: Concurrency / 409 Duplicate Active Scan Protection
  // ─────────────────────────────────────────────────────────────────────────
  log('\n--- Step 3: Duplicate Active Scan Protection (HTTP 409) ---');

  // Try immediately while the first scan is active (QUEUED or RUNNING)
  const dupRes = await httpFetch(`${BACKEND_URL}/api/repositories/${repoA._id}/scans`, {
    method: 'POST',
    headers: authHeadersA,
    body: JSON.stringify({}),
  });

  // If the first scan already finished (unlikely for real GitHub fetch), test deterministically
  if (dupRes.status === 409) {
    assert(dupRes.status === 409, 'Duplicate scan request during active scan returns HTTP 409');
    const errCode = dupRes.data.error && (dupRes.data.error.code || dupRes.data.error);
    assert(String(errCode).includes('SCAN_ALREADY_IN_PROGRESS'),
      '409 error code is SCAN_ALREADY_IN_PROGRESS');
  } else {
    // Deterministic test if the scan already finished
    const tempQueued = await Scan.create({
      repositoryId: repoA._id,
      userId: userA._id,
      status: 'QUEUED',
      branch: repoA.defaultBranch,
      commitSha: initialScan.commitSha,
    });
    try {
      const detDupRes = await httpFetch(`${BACKEND_URL}/api/repositories/${repoA._id}/scans`, {
        method: 'POST',
        headers: authHeadersA,
        body: JSON.stringify({}),
      });
      assert(detDupRes.status === 409, 'Deterministic: Duplicate scan returns HTTP 409');
    } finally {
      await Scan.findByIdAndDelete(tempQueued._id);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Step 4: Polling Scan Status until Terminal State
  // ─────────────────────────────────────────────────────────────────────────
  log('\n--- Step 4: Real Scan Execution Lifecycle Polling ---');

  const pollStart = Date.now();
  const timeoutMs = 120000; // 2 minutes for real GitHub fetch + AST parsing
  let currentStatus = initialScan.status;
  let finalScanResponse = null;
  const observedStatuses = new Set([currentStatus]);

  while (Date.now() - pollStart < timeoutMs) {
    await new Promise((res) => setTimeout(res, 1500));

    const pollRes = await httpFetch(`${BACKEND_URL}/api/repositories/${repoA._id}/scans/${validationScanId}`, {
      headers: authHeadersA,
    });

    if (pollRes.status === 200 && pollRes.data.scan) {
      currentStatus = pollRes.data.scan.status;
      observedStatuses.add(currentStatus);
      const elapsedSec = ((Date.now() - pollStart) / 1000).toFixed(1);
      log(`  [Poll ${elapsedSec}s] Scan status: ${currentStatus}`);

      if (currentStatus === 'COMPLETED' || currentStatus === 'FAILED') {
        finalScanResponse = pollRes.data.scan;
        break;
      }
    } else {
      log(`  [Poll error] HTTP ${pollRes.status}: ${JSON.stringify(pollRes.data)}`);
    }
  }

  log(`Observed status progression: ${Array.from(observedStatuses).join(' -> ')}`);
  assert(observedStatuses.has('RUNNING') || observedStatuses.has('COMPLETED'),
    'Scan progressed beyond QUEUED state');
  assert(currentStatus === 'COMPLETED', `Scan reached terminal status COMPLETED (got: ${currentStatus})`);

  // ─────────────────────────────────────────────────────────────────────────
  // Step 5: MongoDB Persistence Verification (Scan & AnalysisResult)
  // ─────────────────────────────────────────────────────────────────────────
  log('\n--- Step 5: MongoDB Persistence Verification ---');

  const scanInDb = await Scan.findById(validationScanId);
  assert(Boolean(scanInDb), 'Scan document persisted in MongoDB');
  assert(scanInDb.status === 'COMPLETED', 'Persisted Scan status is COMPLETED');
  assert(scanInDb.startedAt instanceof Date, 'Scan startedAt is a valid Date');
  assert(scanInDb.completedAt instanceof Date, 'Scan completedAt is a valid Date');
  assert(scanInDb.completedAt >= scanInDb.startedAt, 'Scan completedAt >= startedAt');
  assert(scanInDb.filesScanned > 0, `Scan filesScanned > 0 (got: ${scanInDb.filesScanned})`);
  assert(typeof scanInDb.findingsCount === 'number', `Scan findingsCount is a number (got: ${scanInDb.findingsCount})`);
  assert(scanInDb.error === null || scanInDb.error === undefined, 'Successful scan has no error field');

  // Verify AnalysisResult document
  const resultDocs = await AnalysisResult.find({ scanId: validationScanId });
  assert(resultDocs.length === 1, `Exactly one AnalysisResult exists for scan (count: ${resultDocs.length})`);

  const result = resultDocs[0];
  let createdResultId = null;
  if (result) {
    createdResultId = result._id;
    assert(result.scanId.toString() === validationScanId.toString(), 'AnalysisResult.scanId matches');
    assert(result.repositoryId.toString() === repoA._id.toString(), 'AnalysisResult.repositoryId matches');
    assert(result.userId.toString() === userA._id.toString(), 'AnalysisResult.userId matches');
    assert(result.branch === repoA.defaultBranch, 'AnalysisResult.branch matches');
    assert(result.commitSha === scanInDb.commitSha, 'AnalysisResult.commitSha matches');
    assert(result.analyzerVersion === '1.0.0', 'AnalysisResult.analyzerVersion is 1.0.0');

    // Structural checks
    assert(result.fileCounts && typeof result.fileCounts.total === 'number',
      `AnalysisResult.fileCounts.total is present (${result.fileCounts.total})`);
    assert(result.fileCounts.total === scanInDb.filesScanned,
      `fileCounts.total (${result.fileCounts.total}) matches Scan.filesScanned (${scanInDb.filesScanned})`);

    assert(result.facts && result.facts.code && Array.isArray(result.facts.code.apiEndpoints),
      'AnalysisResult.facts.code.apiEndpoints is an array');
    assert(result.facts && result.facts.documentation && Array.isArray(result.facts.documentation.apiEndpoints),
      'AnalysisResult.facts.documentation.apiEndpoints is an array');

    assert(result.drift && result.drift.summary && typeof result.drift.summary.total === 'number',
      `AnalysisResult.drift.summary.total is present (${result.drift.summary.total})`);
    assert(result.drift.summary.total === scanInDb.findingsCount,
      `drift.summary.total (${result.drift.summary.total}) matches Scan.findingsCount (${scanInDb.findingsCount})`);
    assert(Array.isArray(result.drift.findings), 'AnalysisResult.drift.findings is an array');

    // Security contract checks
    assert(!result.files || !Array.isArray(result.files), 'Raw files[] inventory is NOT persisted in AnalysisResult');

    // Check env vars: only name, file, line (no secrets/values)
    const allEnvVars = [
      ...(result.facts.code.envVars || []),
      ...(result.facts.documentation.envVars || []),
    ];
    const hasValues = allEnvVars.some((ev) => ev.value !== undefined || ev.secret !== undefined);
    assert(!hasValues, 'Environment variable values/secrets are NOT stored (only name, file, line)');

    // Check dependencies mapping
    const deps = result.facts.code.dependencies || [];
    assert(deps.length > 0, `AnalysisResult has mapped dependencies (count: ${deps.length})`);
    const validEnums = new Set(['production', 'development', 'peer', 'optional', 'unknown']);
    assert(deps.every((d) => validEnums.has(d.type)), 'All dependency types are valid schema enum values');
    assert(!deps.some((d) => d.type === 'DEPENDENCY'), "Zero dependencies have fact type 'DEPENDENCY'");
    const prodDeps = deps.filter((d) => d.type === 'production');
    const devDeps = deps.filter((d) => d.type === 'development');
    assert(prodDeps.length > 0, `Production dependencies identified (count: ${prodDeps.length})`);
    assert(devDeps.length > 0, `Development dependencies identified (count: ${devDeps.length})`);
    assert(deps.every((d) => d.name && d.name.length > 0), 'All dependencies have non-empty names');

    // Check scripts mapping
    const scripts = result.facts.code.scripts || [];
    assert(scripts.length > 0, `AnalysisResult has mapped scripts (count: ${scripts.length})`);
    assert(scripts.every((s) => s.name && s.name.length > 0), 'All scripts have non-empty names');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Step 6: Authorization & Ownership Isolation Verification
  // ─────────────────────────────────────────────────────────────────────────
  log('\n--- Step 6: Authorization & Ownership Isolation ---');

  // Cross-user read scan: User B cannot access User A's scan
  const crossUserScanRead = await httpFetch(
    `${BACKEND_URL}/api/repositories/${repoA._id}/scans/${validationScanId}`,
    { headers: authHeadersB }
  );
  assert(crossUserScanRead.status === 404, 'User B reading User A scan returns HTTP 404');

  // Cross-user create scan: User B cannot trigger scan on User A's repository
  const crossUserScanCreate = await httpFetch(
    `${BACKEND_URL}/api/repositories/${repoA._id}/scans`,
    {
      method: 'POST',
      headers: authHeadersB,
      body: JSON.stringify({}),
    }
  );
  assert(crossUserScanCreate.status === 404, 'User B creating scan on User A repository returns HTTP 404');

  // Unauthenticated scan read
  const unauthScanRead = await httpFetch(
    `${BACKEND_URL}/api/repositories/${repoA._id}/scans/${validationScanId}`
  );
  assert(unauthScanRead.status === 401, 'Unauthenticated scan read returns HTTP 401');

  // Unauthenticated scan create
  const unauthScanCreate = await httpFetch(
    `${BACKEND_URL}/api/repositories/${repoA._id}/scans`,
    { method: 'POST', body: JSON.stringify({}) }
  );
  assert(unauthScanCreate.status === 401, 'Unauthenticated scan creation returns HTTP 401');

  // Cross-user direct DB check
  const crossDbResult = await AnalysisResult.findOne({
    scanId: validationScanId,
    userId: userB._id,
  });
  assert(crossDbResult === null, 'AnalysisResult queried with mismatched userId returns null');

  // ─────────────────────────────────────────────────────────────────────────
  // Step 7: Cleanup
  // ─────────────────────────────────────────────────────────────────────────
  log('\n--- Step 7: Cleanup of Validation Records ---');

  if (validationScanId) {
    await Scan.findByIdAndDelete(validationScanId);
    log(`  Cleaned up validation Scan: ${validationScanId}`);
  }
  if (createdResultId) {
    await AnalysisResult.findByIdAndDelete(createdResultId);
    log(`  Cleaned up validation AnalysisResult: ${createdResultId}`);
  }

  // Verify pre-existing data is intact
  const remainingRepos = await Repository.countDocuments();
  const remainingUsers = await User.countDocuments();
  assert(remainingRepos >= 6, `Pre-existing repositories preserved (${remainingRepos})`);
  assert(remainingUsers >= 9, `Pre-existing users preserved (${remainingUsers})`);

  await mongoose.disconnect();

  // ─────────────────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────────────────
  log('\n=============================================================');
  log(`  Validation Results: ${passed} passed, ${failed} failed`);
  log('=============================================================\n');

  if (failures.length > 0) {
    log('Failures:');
    failures.forEach((f) => log(`  - ${f}`));
    process.exit(1);
  }

  log('Phase 5B.3 Real End-to-End Validation PASSED!\n');
  process.exit(0);
}

runValidation().catch((err) => {
  console.error('\nFatal error in validation runner:', err);
  process.exit(1);
});
