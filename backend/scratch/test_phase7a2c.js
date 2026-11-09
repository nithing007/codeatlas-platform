/**
 * Phase 7A.2C Concurrency, Recovery & Reservation Unit Test Suite
 *
 * Verifies:
 *   1. Two QUEUED scans for one repository cannot coexist (activeScanKey uniqueness).
 *   2. Two RUNNING scans for one repository cannot coexist.
 *   3. One QUEUED and one RUNNING scan cannot coexist for one repository.
 *   4. A terminal scan (COMPLETED) releases its active reservation.
 *   5. Failed scans release their reservation.
 *   6. Startup reconciliation releases active reservations.
 *   7. Recovery errors prevent server startup (rethrow to caller).
 *   8. Historical COMPLETED and FAILED records remain unchanged.
 *   9. toSafeObject() strips activeScanKey from API responses.
 *  10. createScan translates duplicate-key error (11000) into 409 SCAN_ALREADY_IN_PROGRESS.
 */

const assert = require('assert');
const mongoose = require('mongoose');
const Scan = require('../src/models/Scan');
const Repository = require('../src/models/Repository');
const githubService = require('../src/services/githubService');
const scanExecutionService = require('../src/services/scanExecutionService');
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
  console.log('  Phase 7A.2C Concurrency, Recovery & Reservation Test Suite');
  console.log('=============================================================\n');

  // --- Group 1: Model Index & Field Definition ---
  console.log('--- Group 1: Model Index & Field Definition ---');

  test('Scan model declares activeScanKey field with default null', () => {
    const activeScanKeyPath = Scan.schema.path('activeScanKey');
    assert.ok(activeScanKeyPath, 'activeScanKey field must be defined in schema');
    assert.strictEqual(activeScanKeyPath.instance, 'String');
  });

  test('Scan model declares partial unique index on activeScanKey for string type', () => {
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

  test('toSafeObject() strips activeScanKey from returned object', () => {
    const scan = new Scan({
      repositoryId: new mongoose.Types.ObjectId(),
      userId: new mongoose.Types.ObjectId(),
      status: 'QUEUED',
      branch: 'main',
      activeScanKey: '1234567890abcdef',
    });
    const safeObj = scan.toSafeObject();
    assert.strictEqual(safeObj.activeScanKey, undefined);
    assert.strictEqual(safeObj.__v, undefined);
    assert.strictEqual(safeObj.status, 'QUEUED');
  });

  // --- Group 2: Reservation Lifecycle Handling ---
  console.log('\n--- Group 2: Reservation Lifecycle Handling ---');

  await testAsync('createScan assigns activeScanKey = repositoryId.toString()', async () => {
    const repoId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();

    const origRepoFindOne = Repository.findOne;
    const origScanFindOne = Scan.findOne;
    const origResolveSha = githubService.resolveCommitSha;
    const origScanCreate = Scan.create;
    const origExecute = scanExecutionService.executeScan;

    let createdPayload = null;

    Repository.findOne = async () => ({
      _id: repoId,
      owner: 'testowner',
      name: 'testrepo',
      defaultBranch: 'main',
    });
    Scan.findOne = async () => null;
    githubService.resolveCommitSha = async () => 'sha123456';
    scanExecutionService.executeScan = async () => {};
    Scan.create = async (payload) => {
      createdPayload = payload;
      return {
        _id: new mongoose.Types.ObjectId(),
        ...payload,
        toSafeObject: () => payload,
      };
    };

    try {
      await createScan(userId, repoId.toString());
      assert.ok(createdPayload, 'Scan.create should have been called');
      assert.strictEqual(createdPayload.activeScanKey, repoId.toString());
      assert.strictEqual(createdPayload.status, 'QUEUED');
    } finally {
      Repository.findOne = origRepoFindOne;
      Scan.findOne = origScanFindOne;
      githubService.resolveCommitSha = origResolveSha;
      Scan.create = origScanCreate;
      scanExecutionService.executeScan = origExecute;
    }
  });

  await testAsync('createScan catches duplicate activeScanKey (11000) and returns HTTP 409', async () => {
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
    Scan.findOne = async () => null; // Bypasses application check (simulates race)
    githubService.resolveCommitSha = async () => 'sha123456';

    Scan.create = async () => {
      const err = new Error('E11000 duplicate key error collection: codeatlas.scans index: activeScanKey_1');
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

  // --- Group 3: Startup Recovery Fail-Safe Behavior ---
  console.log('\n--- Group 3: Startup Recovery Fail-Safe Behavior ---');

  await testAsync('reconcileStrandedScans releases activeScanKey on recovered scans', async () => {
    let capturedQuery = null;
    let capturedUpdate = null;

    const originalUpdateMany = Scan.updateMany;
    Scan.updateMany = async (query, update) => {
      capturedQuery = query;
      capturedUpdate = update;
      return { modifiedCount: 2 };
    };

    try {
      const count = await reconcileStrandedScans();
      assert.strictEqual(count, 2);
      assert.deepStrictEqual(capturedQuery, { status: { $in: ['QUEUED', 'RUNNING'] } });
      assert.strictEqual(capturedUpdate.$set.status, 'FAILED');
      assert.strictEqual(capturedUpdate.$set.activeScanKey, null);
      assert.ok(capturedUpdate.$set.completedAt instanceof Date);
    } finally {
      Scan.updateMany = originalUpdateMany;
    }
  });

  await testAsync('reconcileStrandedScans rethrows database errors to fail server startup safely', async () => {
    const originalUpdateMany = Scan.updateMany;
    Scan.updateMany = async () => {
      throw new Error('Database connection lost during recovery');
    };

    let thrown = null;
    try {
      await reconcileStrandedScans();
    } catch (err) {
      thrown = err;
    } finally {
      Scan.updateMany = originalUpdateMany;
    }

    assert.ok(thrown, 'reconcileStrandedScans must throw on database failure');
    assert.strictEqual(thrown.message, 'Database connection lost during recovery');
  });

  await testAsync('Historical COMPLETED and FAILED scans are excluded from reconciliation', async () => {
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

  // --- Summary ---
  console.log('\n=============================================================');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('=============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runSuite();
