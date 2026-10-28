/**
 * Phase 5B.1 — AnalysisResult Model Test Suite
 *
 * Tests the AnalysisResult Mongoose model schema.
 * Covers:
 *   - Required field validation
 *   - 1:1 scanId unique index
 *   - Ownership isolation (userId, repositoryId denormalisation)
 *   - Security contract (no secrets, no file contents, env var names only)
 *   - Structural contract (no raw files[] inventory)
 *   - Sub-schema validation (finding types/severities)
 *   - Default values
 *   - toSafeObject()
 *   - Timestamps
 *
 * Run: node scratch/test_phase5b1.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const AnalysisResult = require('../src/models/AnalysisResult');
const User = require('../src/models/User');
const Repository = require('../src/models/Repository');
const Scan = require('../src/models/Scan');
const config = require('../src/config');

// ---------------------------------------------------------------------------
// Test runner helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, testName, detail = '') {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
    passed++;
  } else {
    const msg = detail ? `${testName} — ${detail}` : testName;
    console.error(`  [FAIL] ${msg}`);
    failures.push(msg);
    failed++;
  }
}

async function assertThrows(fn, testName) {
  try {
    await fn();
    console.error(`  [FAIL] ${testName} — expected error but none was thrown`);
    failures.push(`${testName} — expected error but none was thrown`);
    failed++;
  } catch {
    console.log(`  [PASS] ${testName}`);
    passed++;
  }
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function makeIds() {
  return {
    scanId: new mongoose.Types.ObjectId(),
    repositoryId: new mongoose.Types.ObjectId(),
    userId: new mongoose.Types.ObjectId(),
  };
}

function makeValidPayload(overrides = {}) {
  return {
    ...makeIds(),
    commitSha: 'abc123def456',
    branch: 'main',
    analyzerVersion: '1.0.0',
    fileCounts: { total: 20, source: 10, documentation: 3, configuration: 4, infrastructure: 2, other: 1 },
    facts: {
      code: {
        apiEndpoints: [{ method: 'GET', path: '/api/users', file: 'src/routes.js', line: 10 }],
        envVars: [{ name: 'DATABASE_URL', file: '.env.example', line: 1 }],
        dependencies: [{ name: 'express', version: '^4.18.0', type: 'production' }],
        scripts: [{ name: 'start', command: 'node server.js' }],
      },
      documentation: {
        apiEndpoints: [{ method: 'GET', path: '/api/users', file: 'README.md', line: 45 }],
        envVars: [{ name: 'DATABASE_URL', file: 'README.md', line: 12 }],
      },
    },
    drift: {
      summary: { total: 1, high: 1, medium: 0, low: 0 },
      findings: [
        {
          type: 'UNDOCUMENTED_API',
          severity: 'HIGH',
          title: 'POST /api/users is not documented',
          message: 'The endpoint POST /api/users appears in source code but is not documented.',
          resource: { method: 'POST', path: '/api/users' },
          codeEvidence: { file: 'src/routes.js', line: 20, method: 'POST', path: '/api/users', name: null },
          documentationEvidence: null,
        },
      ],
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function runTests() {
  console.log('\n=============================================================');
  console.log('  Phase 5B.1 — AnalysisResult Model Test Suite');
  console.log('=============================================================\n');

  await mongoose.connect(config.mongodbUri);
  console.log('Connected to MongoDB\n');

  // Clean up any leftover test data from previous runs
  await AnalysisResult.deleteMany({});

  // -------------------------------------------------------------------------
  // TEST 1 — Valid document saves successfully
  // -------------------------------------------------------------------------
  console.log('Group 1: Basic persistence');

  const ids1 = makeIds();
  const doc1 = await AnalysisResult.create(makeValidPayload(ids1));
  assert(doc1._id != null, 'TEST 1: Valid document saves successfully');

  // -------------------------------------------------------------------------
  // TEST 2 — scanId is required
  // -------------------------------------------------------------------------
  await assertThrows(
    () => AnalysisResult.create(makeValidPayload({ scanId: undefined })),
    'TEST 2: scanId is required'
  );

  // -------------------------------------------------------------------------
  // TEST 3 — repositoryId is required
  // -------------------------------------------------------------------------
  await assertThrows(
    () => AnalysisResult.create(makeValidPayload({ repositoryId: undefined })),
    'TEST 3: repositoryId is required'
  );

  // -------------------------------------------------------------------------
  // TEST 4 — userId is required
  // -------------------------------------------------------------------------
  await assertThrows(
    () => AnalysisResult.create(makeValidPayload({ userId: undefined })),
    'TEST 4: userId is required'
  );

  // -------------------------------------------------------------------------
  // TEST 5 — analyzerVersion is required
  // -------------------------------------------------------------------------
  await assertThrows(
    () => AnalysisResult.create(makeValidPayload({ analyzerVersion: undefined })),
    'TEST 5: analyzerVersion is required'
  );

  // -------------------------------------------------------------------------
  // TEST 6 — 1:1 unique index: duplicate scanId is rejected
  // -------------------------------------------------------------------------
  console.log('\nGroup 2: 1:1 uniqueness enforcement');

  const ids6 = makeIds();
  await AnalysisResult.create(makeValidPayload(ids6));
  await assertThrows(
    () => AnalysisResult.create(makeValidPayload({ ...ids6, repositoryId: new mongoose.Types.ObjectId() })),
    'TEST 6: Duplicate scanId is rejected (unique index)'
  );

  // -------------------------------------------------------------------------
  // TEST 7 — Same userId, different scanIds: both save successfully
  // -------------------------------------------------------------------------
  const sharedUserId = new mongoose.Types.ObjectId();
  const r7a = await AnalysisResult.create(makeValidPayload({ scanId: new mongoose.Types.ObjectId(), userId: sharedUserId }));
  const r7b = await AnalysisResult.create(makeValidPayload({ scanId: new mongoose.Types.ObjectId(), userId: sharedUserId }));
  assert(r7a._id != null && r7b._id != null, 'TEST 7: Same userId, different scanIds both save successfully');

  // -------------------------------------------------------------------------
  // TEST 8 — userId is denormalised onto the document (ownership isolation)
  // -------------------------------------------------------------------------
  console.log('\nGroup 3: Ownership isolation');

  const ids8 = makeIds();
  const doc8 = await AnalysisResult.create(makeValidPayload(ids8));
  assert(
    doc8.userId.toString() === ids8.userId.toString(),
    'TEST 8: userId is denormalised and stored on document'
  );

  // -------------------------------------------------------------------------
  // TEST 9 — repositoryId is denormalised onto the document
  // -------------------------------------------------------------------------
  assert(
    doc8.repositoryId.toString() === ids8.repositoryId.toString(),
    'TEST 9: repositoryId is denormalised and stored on document'
  );

  // -------------------------------------------------------------------------
  // TEST 10 — Result can be found by { scanId, userId } (ownership check)
  // -------------------------------------------------------------------------
  const found10 = await AnalysisResult.findOne({ scanId: ids8.scanId, userId: ids8.userId });
  assert(found10 != null, 'TEST 10: Result findable by { scanId, userId } ownership check');

  // -------------------------------------------------------------------------
  // TEST 11 — Ownership isolation: cross-user query returns null
  // -------------------------------------------------------------------------
  const otherUserId = new mongoose.Types.ObjectId();
  const found11 = await AnalysisResult.findOne({ scanId: ids8.scanId, userId: otherUserId });
  assert(found11 === null, 'TEST 11: Cross-user query returns null (ownership isolation)');

  // -------------------------------------------------------------------------
  // TEST 12 — commitSha and branch are persisted
  // -------------------------------------------------------------------------
  console.log('\nGroup 4: Metadata fields');

  const ids12 = makeIds();
  const doc12 = await AnalysisResult.create(makeValidPayload({ ...ids12, commitSha: 'deadbeef1234', branch: 'develop' }));
  assert(doc12.commitSha === 'deadbeef1234', 'TEST 12a: commitSha is persisted');
  assert(doc12.branch === 'develop', 'TEST 12b: branch is persisted');

  // -------------------------------------------------------------------------
  // TEST 13 — commitSha and branch default to null
  // -------------------------------------------------------------------------
  const ids13 = makeIds();
  const doc13 = await AnalysisResult.create(makeValidPayload({ ...ids13, commitSha: undefined, branch: undefined }));
  assert(doc13.commitSha === null, 'TEST 13a: commitSha defaults to null');
  assert(doc13.branch === null, 'TEST 13b: branch defaults to null');

  // -------------------------------------------------------------------------
  // TEST 14 — analyzerVersion is persisted
  // -------------------------------------------------------------------------
  const ids14 = makeIds();
  const doc14 = await AnalysisResult.create(makeValidPayload({ ...ids14, analyzerVersion: '2.3.1' }));
  assert(doc14.analyzerVersion === '2.3.1', 'TEST 14: analyzerVersion is persisted');

  // -------------------------------------------------------------------------
  // TEST 15 — fileCounts fields are persisted correctly
  // -------------------------------------------------------------------------
  console.log('\nGroup 5: Structural contract');

  const ids15 = makeIds();
  const doc15 = await AnalysisResult.create(makeValidPayload({
    ...ids15,
    fileCounts: { total: 50, source: 30, documentation: 5, configuration: 8, infrastructure: 4, other: 3 },
  }));
  assert(doc15.fileCounts.total === 50, 'TEST 15a: fileCounts.total persisted');
  assert(doc15.fileCounts.source === 30, 'TEST 15b: fileCounts.source persisted');
  assert(doc15.fileCounts.documentation === 5, 'TEST 15c: fileCounts.documentation persisted');

  // -------------------------------------------------------------------------
  // TEST 16 — Raw file paths / contents are not a field on the schema
  // -------------------------------------------------------------------------
  const ids16 = makeIds();
  const payloadWithFiles = makeValidPayload({ ...ids16, files: [{ path: 'src/app.js', content: 'module.exports = {}' }] });
  const doc16 = await AnalysisResult.create(payloadWithFiles);
  assert(doc16.files === undefined, 'TEST 16: raw files[] inventory is NOT persisted (security/structural contract)');

  // -------------------------------------------------------------------------
  // TEST 17 — Security contract: env var names stored, values not accepted
  // -------------------------------------------------------------------------
  console.log('\nGroup 6: Security contract');

  const ids17 = makeIds();
  const payloadWithValues = makeValidPayload({
    ...ids17,
    facts: {
      code: {
        envVars: [
          { name: 'DATABASE_URL', file: '.env.example', line: 1, value: 'mongodb://secret@host/db' },
        ],
        apiEndpoints: [],
        dependencies: [],
        scripts: [],
      },
      documentation: { apiEndpoints: [], envVars: [] },
    },
  });
  const doc17 = await AnalysisResult.create(payloadWithValues);
  const envVar17 = doc17.facts.code.envVars[0];
  assert(envVar17.name === 'DATABASE_URL', 'TEST 17a: env var name is stored');
  assert(envVar17.value === undefined, 'TEST 17b: env var value is NOT stored (security contract)');

  // -------------------------------------------------------------------------
  // TEST 18 — Finding type validation: invalid type rejected
  // -------------------------------------------------------------------------
  console.log('\nGroup 7: Finding schema validation');

  await assertThrows(
    () => AnalysisResult.create(makeValidPayload({
      ...makeIds(),
      drift: {
        summary: { total: 1, high: 1, medium: 0, low: 0 },
        findings: [{
          type: 'INVALID_TYPE',
          severity: 'HIGH',
          title: 'Bad finding',
          message: 'This type is not valid.',
          resource: { path: '/test' },
        }],
      },
    })),
    'TEST 18: Invalid finding type is rejected'
  );

  // -------------------------------------------------------------------------
  // TEST 19 — Finding severity validation: invalid severity rejected
  // -------------------------------------------------------------------------
  await assertThrows(
    () => AnalysisResult.create(makeValidPayload({
      ...makeIds(),
      drift: {
        summary: { total: 1, high: 0, medium: 0, low: 0 },
        findings: [{
          type: 'UNDOCUMENTED_API',
          severity: 'CRITICAL',
          title: 'Bad severity',
          message: 'CRITICAL is not a valid severity.',
          resource: { path: '/test' },
        }],
      },
    })),
    'TEST 19: Invalid finding severity is rejected'
  );

  // -------------------------------------------------------------------------
  // TEST 20 — toSafeObject strips __v, preserves key fields
  // -------------------------------------------------------------------------
  console.log('\nGroup 8: toSafeObject and timestamps');

  const ids20 = makeIds();
  const doc20 = await AnalysisResult.create(makeValidPayload(ids20));
  const safe20 = doc20.toSafeObject();
  assert(safe20.__v === undefined, 'TEST 20a: toSafeObject strips __v');
  assert(safe20._id != null, 'TEST 20b: toSafeObject preserves _id');
  assert(safe20.createdAt != null, 'TEST 20c: toSafeObject preserves createdAt timestamp');
  assert(safe20.updatedAt != null, 'TEST 20d: toSafeObject preserves updatedAt timestamp');
  assert(safe20.scanId.toString() === ids20.scanId.toString(), 'TEST 20e: toSafeObject preserves scanId');
  assert(safe20.analyzerVersion === '1.0.0', 'TEST 20f: toSafeObject preserves analyzerVersion');

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------
  await AnalysisResult.deleteMany({});
  await mongoose.disconnect();

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log('\n=============================================================');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('=============================================================\n');

  if (failures.length > 0) {
    console.error('Failures:');
    failures.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  }

  console.log('All Phase 5B.1 tests passed.\n');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
