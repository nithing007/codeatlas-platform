/**
 * Phase 7A.2B Verification Test Suite
 *
 * Covers:
 *   1. Evidence source-to-file mapping
 *   2. Evidence context flag persistence
 *   3. API endpoint file path persistence
 *   4. Environment-variable file path persistence
 *   5. Existing analysis record compatibility
 *   6. Concurrent scan creation protection (index definitions & simulation)
 *   7. Duplicate-key error handling (HTTP 409 SCAN_ALREADY_IN_PROGRESS)
 *   8. Startup recovery of QUEUED scans
 *   9. Startup recovery of RUNNING scans
 *  10. Preservation of COMPLETED and FAILED scans
 */

const assert = require('assert');
const mongoose = require('mongoose');
const AnalysisResult = require('../src/models/AnalysisResult');
const Scan = require('../src/models/Scan');
const Repository = require('../src/models/Repository');
const githubService = require('../src/services/githubService');
const {
  mapEnvVars,
  mapApiEndpoints,
  mapEvidence,
  mapDrift,
  mapFacts,
} = require('../src/services/scanExecutionService');
const { createScan, reconcileStrandedScans } = require('../src/services/scanService');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
    failed++;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
    failed++;
  }
}

async function runSuite() {
  console.log('\n=============================================================');
  console.log('  Phase 7A.2B Integration Blocker Fixes Test Suite');
  console.log('=============================================================\n');

  // --- Group 1: Evidence Source-to-File Mapping ---
  console.log('--- Group 1: Evidence Source-to-File Mapping ---');

  test('mapEvidence maps analyzer source into file and retains source', () => {
    const raw = { source: 'src/routes/auth.js', line: 42 };
    const mapped = mapEvidence(raw);
    assert.strictEqual(mapped.file, 'src/routes/auth.js');
    assert.strictEqual(mapped.source, 'src/routes/auth.js');
    assert.strictEqual(mapped.line, 42);
  });

  test('mapEvidence handles backward-compatible file property', () => {
    const raw = { file: 'src/controllers/user.js', line: 15 };
    const mapped = mapEvidence(raw);
    assert.strictEqual(mapped.file, 'src/controllers/user.js');
    assert.strictEqual(mapped.source, 'src/controllers/user.js');
    assert.strictEqual(mapped.line, 15);
  });

  test('mapEvidence handles null / undefined evidence safely', () => {
    assert.strictEqual(mapEvidence(null), null);
    assert.strictEqual(mapEvidence(undefined), null);
    assert.strictEqual(mapEvidence('invalid'), null);
  });

  test('mapEvidence preserves HTTP method and path metadata', () => {
    const raw = { source: 'routes.js', line: 10, method: 'POST', path: '/api/v1/auth' };
    const mapped = mapEvidence(raw);
    assert.strictEqual(mapped.method, 'POST');
    assert.strictEqual(mapped.path, '/api/v1/auth');
  });

  test('mapEvidence preserves environment variable name', () => {
    const raw = { source: '.env.example', line: 5, name: 'PORT' };
    const mapped = mapEvidence(raw);
    assert.strictEqual(mapped.name, 'PORT');
  });

  // --- Group 2: Evidence Context Flag Persistence ---
  console.log('\n--- Group 2: Evidence Context Flag Persistence ---');

  test('mapEvidence preserves code evidence flags (prefixResolved, fromTemplate, fromOpenApi)', () => {
    const raw = {
      source: 'src/routes.js',
      line: 20,
      prefixResolved: true,
      fromTemplate: true,
      fromOpenApi: true,
    };
    const mapped = mapEvidence(raw);
    assert.strictEqual(mapped.prefixResolved, true);
    assert.strictEqual(mapped.fromTemplate, true);
    assert.strictEqual(mapped.fromOpenApi, true);
  });

  test('mapEvidence preserves doc evidence flags (fromCurl, fromTable, fromOpenApi, fromDocumentation)', () => {
    const raw = {
      source: 'README.md',
      line: 88,
      fromCurl: true,
      fromTable: true,
      fromOpenApi: true,
      fromDocumentation: true,
    };
    const mapped = mapEvidence(raw);
    assert.strictEqual(mapped.fromCurl, true);
    assert.strictEqual(mapped.fromTable, true);
    assert.strictEqual(mapped.fromOpenApi, true);
    assert.strictEqual(mapped.fromDocumentation, true);
  });

  test('mapDrift maps findings and evidence objects correctly', () => {
    const rawDrift = {
      summary: { total: 1, high: 1, medium: 0, low: 0 },
      findings: [
        {
          type: 'UNDOCUMENTED_API',
          severity: 'HIGH',
          title: 'Undocumented API',
          message: 'Route not found in docs',
          resource: { method: 'POST', path: '/api/users' },
          codeEvidence: { source: 'src/users.js', line: 12, prefixResolved: true },
          documentationEvidence: null,
        },
      ],
    };
    const mapped = mapDrift(rawDrift);
    assert.strictEqual(mapped.summary.total, 1);
    assert.strictEqual(mapped.findings.length, 1);
    assert.strictEqual(mapped.findings[0].codeEvidence.file, 'src/users.js');
    assert.strictEqual(mapped.findings[0].codeEvidence.prefixResolved, true);
    assert.strictEqual(mapped.findings[0].documentationEvidence, null);
  });

  test('AnalysisResult Mongoose schema preserves context flags on document cast', () => {
    const doc = new AnalysisResult({
      scanId: new mongoose.Types.ObjectId(),
      repositoryId: new mongoose.Types.ObjectId(),
      userId: new mongoose.Types.ObjectId(),
      analyzerVersion: '1.0.0',
      drift: {
        summary: { total: 1, high: 1, medium: 0, low: 0 },
        findings: [
          {
            type: 'UNDOCUMENTED_API',
            severity: 'HIGH',
            title: 'Undocumented API',
            message: 'Message',
            resource: { method: 'POST', path: '/api/test' },
            codeEvidence: {
              file: 'src/app.js',
              source: 'src/app.js',
              line: 14,
              prefixResolved: true,
              fromTemplate: true,
              fromOpenApi: true,
            },
            documentationEvidence: {
              file: 'README.md',
              source: 'README.md',
              line: 30,
              fromCurl: true,
              fromTable: true,
              fromOpenApi: true,
              fromDocumentation: true,
            },
          },
        ],
      },
    });

    const finding = doc.drift.findings[0];
    assert.strictEqual(finding.codeEvidence.file, 'src/app.js');
    assert.strictEqual(finding.codeEvidence.source, 'src/app.js');
    assert.strictEqual(finding.codeEvidence.prefixResolved, true);
    assert.strictEqual(finding.codeEvidence.fromTemplate, true);
    assert.strictEqual(finding.codeEvidence.fromOpenApi, true);

    assert.strictEqual(finding.documentationEvidence.file, 'README.md');
    assert.strictEqual(finding.documentationEvidence.source, 'README.md');
    assert.strictEqual(finding.documentationEvidence.fromCurl, true);
    assert.strictEqual(finding.documentationEvidence.fromTable, true);
    assert.strictEqual(finding.documentationEvidence.fromOpenApi, true);
    assert.strictEqual(finding.documentationEvidence.fromDocumentation, true);
  });

  // --- Group 3: Extracted Fact Source-to-File Mapping ---
  console.log('\n--- Group 3: Extracted Fact Source-to-File Mapping ---');

  test('mapApiEndpoints maps source to file and source', () => {
    const endpoints = [
      { method: 'GET', path: '/health', source: 'src/routes/health.js', line: 10 },
    ];
    const mapped = mapApiEndpoints(endpoints);
    assert.strictEqual(mapped[0].file, 'src/routes/health.js');
    assert.strictEqual(mapped[0].source, 'src/routes/health.js');
    assert.strictEqual(mapped[0].method, 'GET');
    assert.strictEqual(mapped[0].path, '/health');
    assert.strictEqual(mapped[0].line, 10);
  });

  test('mapEnvVars maps source to file and source (without secrets)', () => {
    const envVars = [
      { name: 'PORT', source: '.env.example', line: 2 },
    ];
    const mapped = mapEnvVars(envVars);
    assert.strictEqual(mapped[0].name, 'PORT');
    assert.strictEqual(mapped[0].file, '.env.example');
    assert.strictEqual(mapped[0].source, '.env.example');
    assert.strictEqual(mapped[0].line, 2);
    assert.strictEqual(mapped[0].value, undefined);
  });

  test('mapFacts integrates API endpoints and env vars with file mappings', () => {
    const rawFacts = {
      codeFacts: {
        apiEndpoints: [{ method: 'POST', path: '/auth', source: 'src/auth.js', line: 5 }],
        environmentVariables: [{ name: 'JWT_SECRET', source: 'src/auth.js', line: 1 }],
        dependencies: [{ name: 'bcryptjs', version: '^2.4.3', section: 'dependencies' }],
        scripts: [{ name: 'start', command: 'node server.js' }],
      },
      documentationFacts: {
        apiEndpoints: [{ method: 'POST', path: '/auth', source: 'README.md', line: 50 }],
        environmentVariables: [{ name: 'JWT_SECRET', source: 'README.md', line: 15 }],
      },
    };
    const mapped = mapFacts(rawFacts);
    assert.strictEqual(mapped.code.apiEndpoints[0].file, 'src/auth.js');
    assert.strictEqual(mapped.code.envVars[0].file, 'src/auth.js');
    assert.strictEqual(mapped.code.dependencies[0].type, 'production');
    assert.strictEqual(mapped.code.scripts[0].name, 'start');
    assert.strictEqual(mapped.documentation.apiEndpoints[0].file, 'README.md');
    assert.strictEqual(mapped.documentation.envVars[0].file, 'README.md');
  });

  // --- Group 4: Existing Analysis Record Compatibility ---
  console.log('\n--- Group 4: Existing Analysis Record Compatibility ---');

  test('AnalysisResult validates legacy records without source or flags', () => {
    const doc = new AnalysisResult({
      scanId: new mongoose.Types.ObjectId(),
      repositoryId: new mongoose.Types.ObjectId(),
      userId: new mongoose.Types.ObjectId(),
      analyzerVersion: '1.0.0',
      facts: {
        code: {
          apiEndpoints: [{ method: 'GET', path: '/test', file: 'test.js', line: 1 }],
          envVars: [{ name: 'PORT', file: '.env.example', line: 1 }],
        },
      },
      drift: {
        summary: { total: 0, high: 0, medium: 0, low: 0 },
        findings: [],
      },
    });

    const err = doc.validateSync();
    assert.strictEqual(err, undefined);
    assert.strictEqual(doc.facts.code.apiEndpoints[0].file, 'test.js');
    assert.strictEqual(doc.facts.code.apiEndpoints[0].source, null);
  });

  // --- Group 5: Concurrent Scan Protection & Startup Recovery ---
  console.log('\n--- Group 5: Concurrent Scan Protection & Startup Recovery ---');

  test('Scan model declares partial unique index for activeScanKey lock', () => {
    const indexes = Scan.schema.indexes();
    const activeIndex = indexes.find(
      (idx) => idx[0].activeScanKey === 1 && idx[1]?.unique === true
    );

    assert.ok(activeIndex, 'Expected partial unique index on activeScanKey');
    assert.strictEqual(activeIndex[1].unique, true);
    assert.deepStrictEqual(activeIndex[1].partialFilterExpression, {
      activeScanKey: { $type: 'string' },
    });
  });

  await testAsync('createScan handles duplicate-key error (code 11000) with HTTP 409', async () => {
    const repoId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();

    const origRepoFindOne = Repository.findOne;
    const origScanFindOne = Scan.findOne;
    const origResolveSha = githubService.resolveCommitSha;
    const origScanCreate = Scan.create;

    Repository.findOne = async () => ({
      _id: repoId,
      owner: 'testowner',
      name: 'testrepo',
      defaultBranch: 'main',
    });
    Scan.findOne = async () => null; // Passes initial findOne check
    githubService.resolveCommitSha = async () => 'abc123commitsha';

    // Simulate concurrent second insert throwing duplicate key code 11000
    Scan.create = async () => {
      const err = new Error('E11000 duplicate key error collection: codeatlas.scans index: repositoryId_1');
      err.code = 11000;
      throw err;
    };

    try {
      let thrown = null;
      try {
        await createScan(userId, repoId.toString());
      } catch (err) {
        thrown = err;
      }

      assert.ok(thrown, 'createScan should throw on duplicate key');
      assert.strictEqual(thrown.statusCode, 409);
      assert.strictEqual(thrown.code, 'SCAN_ALREADY_IN_PROGRESS');
      assert.strictEqual(thrown.message, 'A scan is already in progress for this repository.');
    } finally {
      Repository.findOne = origRepoFindOne;
      Scan.findOne = origScanFindOne;
      githubService.resolveCommitSha = origResolveSha;
      Scan.create = origScanCreate;
    }
  });

  await testAsync('reconcileStrandedScans updates only QUEUED and RUNNING scans to FAILED', async () => {
    let capturedQuery = null;
    let capturedUpdate = null;

    const originalUpdateMany = Scan.updateMany;
    Scan.updateMany = async (query, update) => {
      capturedQuery = query;
      capturedUpdate = update;
      return { modifiedCount: 3 };
    };

    try {
      const recoveredCount = await reconcileStrandedScans();
      assert.strictEqual(recoveredCount, 3);
      assert.deepStrictEqual(capturedQuery, { status: { $in: ['QUEUED', 'RUNNING'] } });
      assert.strictEqual(capturedUpdate.$set.status, 'FAILED');
      assert.ok(capturedUpdate.$set.completedAt instanceof Date);
      assert.strictEqual(
        capturedUpdate.$set.error,
        'Scan was interrupted by server restart. Please trigger a new scan.'
      );
    } finally {
      Scan.updateMany = originalUpdateMany;
    }
  });

  await testAsync('reconcileStrandedScans ignores COMPLETED and FAILED scans', async () => {
    // Verifies the query filter matches only active statuses
    let capturedQuery = null;
    const originalUpdateMany = Scan.updateMany;
    Scan.updateMany = async (query) => {
      capturedQuery = query;
      return { modifiedCount: 0 };
    };

    try {
      await reconcileStrandedScans();
      assert.ok(!capturedQuery.status.$in.includes('COMPLETED'));
      assert.ok(!capturedQuery.status.$in.includes('FAILED'));
    } finally {
      Scan.updateMany = originalUpdateMany;
    }
  });

  await testAsync('reconcileStrandedScans handles zero stranded scans smoothly', async () => {
    const originalUpdateMany = Scan.updateMany;
    Scan.updateMany = async () => ({ modifiedCount: 0 });

    try {
      const recoveredCount = await reconcileStrandedScans();
      assert.strictEqual(recoveredCount, 0);
    } finally {
      Scan.updateMany = originalUpdateMany;
    }
  });

  await testAsync('reconcileStrandedScans rethrows database errors to fail startup safely', async () => {
    const originalUpdateMany = Scan.updateMany;
    Scan.updateMany = async () => {
      throw new Error('Database connection failed');
    };

    let thrown = null;
    try {
      await reconcileStrandedScans();
    } catch (err) {
      thrown = err;
    } finally {
      Scan.updateMany = originalUpdateMany;
    }

    assert.ok(thrown, 'reconcileStrandedScans should rethrow on database error');
    assert.strictEqual(thrown.message, 'Database connection failed');
  });

  // --- Summary ---
  console.log('\n=============================================================');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('=============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runSuite();
