require('dotenv').config();
const mongoose = require('mongoose');
const config = require('../src/config');
const Scan = require('../src/models/Scan');

async function verifyRealMongo() {
  console.log('\n=============================================================');
  console.log('  Real MongoDB Index & Uniqueness Verification');
  console.log('=============================================================\n');

  try {
    console.log('Connecting to MongoDB at:', config.mongodbUri.replace(/\/\/.*@/, '//<redacted>@'));
    await mongoose.connect(config.mongodbUri);
    console.log('Connected to MongoDB successfully.\n');

    // 1. Inspect existing Scan collection and records
    const totalScans = await Scan.countDocuments();
    const activeScans = await Scan.countDocuments({ status: { $in: ['QUEUED', 'RUNNING'] } });
    console.log(`Database Scan Collection State:`);
    console.log(`  Total Scans in DB: ${totalScans}`);
    console.log(`  Active Scans (QUEUED/RUNNING): ${activeScans}\n`);

    // 2. Ensure / sync indexes on Scan model
    console.log('Syncing indexes on Scan collection...');
    await Scan.syncIndexes();
    console.log('Indexes synced successfully.\n');

    // 3. Inspect actual indexes on the MongoDB collection
    const indexes = await Scan.collection.indexes();
    console.log('Actual MongoDB Indexes on "scans":');
    indexes.forEach((idx) => {
      console.log(`  - Name: ${idx.name}, Keys: ${JSON.stringify(idx.key)}, Unique: ${Boolean(idx.unique)}, PartialFilter: ${JSON.stringify(idx.partialFilterExpression || null)}`);
    });
    console.log('');

    // 4. Test Uniqueness: Create a test active scan
    const testRepoId = new mongoose.Types.ObjectId();
    const testUserId = new mongoose.Types.ObjectId();
    const activeScanKey = testRepoId.toString();

    console.log('Test 1: Creating initial QUEUED scan with activeScanKey...');
    const scan1 = await Scan.create({
      repositoryId: testRepoId,
      userId: testUserId,
      status: 'QUEUED',
      branch: 'main',
      activeScanKey,
    });
    console.log(`  Scan 1 created (ID: ${scan1._id}, status: ${scan1.status}, activeScanKey: ${scan1.activeScanKey})`);

    // Test 2: Try creating second QUEUED scan for SAME repository (should fail with code 11000)
    console.log('\nTest 2: Attempting to create duplicate QUEUED scan for same repository...');
    let caughtDuplicateQueued = null;
    try {
      await Scan.create({
        repositoryId: testRepoId,
        userId: testUserId,
        status: 'QUEUED',
        branch: 'main',
        activeScanKey,
      });
    } catch (err) {
      caughtDuplicateQueued = err;
    }
    if (caughtDuplicateQueued && caughtDuplicateQueued.code === 11000) {
      console.log(`  ✅ Correctly rejected duplicate QUEUED scan with code 11000: ${caughtDuplicateQueued.message}`);
    } else {
      throw new Error(`Expected 11000 duplicate key error, got: ${caughtDuplicateQueued}`);
    }

    // Test 3: Transition scan1 to RUNNING, try creating a QUEUED scan (should fail with code 11000)
    console.log('\nTest 3: Transitioning scan 1 to RUNNING, then attempting concurrent QUEUED scan...');
    await Scan.findByIdAndUpdate(scan1._id, { $set: { status: 'RUNNING' } });
    let caughtQueuedWhileRunning = null;
    try {
      await Scan.create({
        repositoryId: testRepoId,
        userId: testUserId,
        status: 'QUEUED',
        branch: 'main',
        activeScanKey,
      });
    } catch (err) {
      caughtQueuedWhileRunning = err;
    }
    if (caughtQueuedWhileRunning && caughtQueuedWhileRunning.code === 11000) {
      console.log(`  ✅ Correctly rejected QUEUED scan while another is RUNNING (code 11000)`);
    } else {
      throw new Error(`Expected 11000 duplicate key error, got: ${caughtQueuedWhileRunning}`);
    }

    // Test 4: Complete scan 1 (release activeScanKey), then create a new scan (should succeed!)
    console.log('\nTest 4: Completing scan 1 (releases activeScanKey) and creating new scan...');
    await Scan.findByIdAndUpdate(scan1._id, {
      $set: {
        status: 'COMPLETED',
        completedAt: new Date(),
        activeScanKey: null,
      },
    });

    const scan2 = await Scan.create({
      repositoryId: testRepoId,
      userId: testUserId,
      status: 'QUEUED',
      branch: 'main',
      activeScanKey,
    });
    console.log(`  ✅ Successfully created new scan after completion (ID: ${scan2._id})`);

    // Test 5: Reconcile stranded scans (simulates restart while scan2 is active)
    console.log('\nTest 5: Testing startup reconciliation of scan 2...');
    const reconcileResult = await Scan.updateMany(
      { status: { $in: ['QUEUED', 'RUNNING'] }, repositoryId: testRepoId },
      {
        $set: {
          status: 'FAILED',
          completedAt: new Date(),
          error: 'Scan was interrupted by server restart. Please trigger a new scan.',
          activeScanKey: null,
        },
      }
    );
    console.log(`  Reconciliation updated ${reconcileResult.modifiedCount} scan(s)`);
    const reconciledScan2 = await Scan.findById(scan2._id);
    if (reconciledScan2.status === 'FAILED' && reconciledScan2.activeScanKey === null) {
      console.log(`  ✅ Scan 2 marked FAILED and activeScanKey released.`);
    } else {
      throw new Error(`Scan 2 not properly reconciled`);
    }

    // Clean up test records
    await Scan.deleteMany({ repositoryId: testRepoId });
    console.log('\nCleaned up test scan documents.');

    console.log('\n=============================================================');
    console.log('  ALL REAL MONGODB INDEX TESTS PASSED!');
    console.log('=============================================================\n');
  } catch (err) {
    console.error('\n❌ Real MongoDB test failed:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

verifyRealMongo();

