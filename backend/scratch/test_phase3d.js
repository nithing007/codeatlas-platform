require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Repository = require('../src/models/Repository');
const Scan = require('../src/models/Scan');
const { generateToken } = require('../src/services/jwtService');
const config = require('../src/config');

async function runPhase3DTests() {
  console.log('\n=============================================================');
  console.log('  Phase 3D Repository Scan Lifecycle Test Suite');
  console.log('=============================================================\n');

  await mongoose.connect(config.mongodbUri);

  // Setup Test Users
  const userAEmail = `scan.user.a.${Date.now()}@example.com`;
  const userBEmail = `scan.user.b.${Date.now()}@example.com`;

  const userA = await User.create({ email: userAEmail, authProvider: 'email', role: 'user' });
  const userB = await User.create({ email: userBEmail, authProvider: 'email', role: 'user' });

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

  // Setup Test Repositories
  const repoA = await Repository.create({
    userId: userA._id,
    githubRepositoryId: '123456',
    name: 'express',
    fullName: 'expressjs/express',
    owner: 'expressjs',
    htmlUrl: 'https://github.com/expressjs/express',
    defaultBranch: 'master',
  });

  const repoB = await Repository.create({
    userId: userB._id,
    githubRepositoryId: '789012',
    name: 'react',
    fullName: 'facebook/react',
    owner: 'facebook',
    htmlUrl: 'https://github.com/facebook/react',
    defaultBranch: 'main',
  });

  // -------------------------------------------------------------
  // Test 1: Unauthenticated user cannot start scan
  // -------------------------------------------------------------
  console.log('TEST 1: Unauthenticated request to start scan returns 401');
  const unauthRes = await fetch(`http://localhost:5000/api/repositories/${repoA._id}/scans`, {
    method: 'POST',
  });
  const unauthData = await unauthRes.json();
  console.log(`  Status: ${unauthRes.status} | Error: "${unauthData.error}"`);
  if (unauthRes.status !== 401) throw new Error('Expected 401 for unauthenticated scan creation');

  // -------------------------------------------------------------
  // Test 2: Authenticated user creates scan (starts as QUEUED)
  // -------------------------------------------------------------
  console.log('\nTEST 2: Authenticated user creates scan for own repository');
  const createScanRes = await fetch(`http://localhost:5000/api/repositories/${repoA._id}/scans`, {
    method: 'POST',
    headers: authHeadersA,
    body: JSON.stringify({
      status: 'COMPLETED', // Malicious attempt to set status directly
      userId: userB._id,   // Malicious attempt to hijack userId
    }),
  });

  const createScanData = await createScanRes.json();
  console.log(`  Status: ${createScanRes.status} | Message: "${createScanData.message}"`);
  console.log(`  Scan ID: ${createScanData.scan?._id || createScanData.scan?.id}`);
  console.log(`  Scan Status: ${createScanData.scan?.status} (Expected: QUEUED)`);
  console.log(`  Scan Branch: ${createScanData.scan?.branch} (Expected: master)`);
  console.log(`  Scan User ID: ${createScanData.scan?.userId}`);

  if (createScanRes.status !== 201 || !createScanData.success) throw new Error('Scan creation failed');
  if (createScanData.scan.status !== 'QUEUED') throw new Error('Scan status must default to QUEUED');
  if (createScanData.scan.userId.toString() !== userA._id.toString()) throw new Error('Scan userId was manipulated');
  if (createScanData.scan.branch !== 'master') throw new Error('Scan branch should match repo default branch');

  const scanIdA1 = createScanData.scan._id || createScanData.scan.id;

  // Create a second scan for repoA to test scan history ordering
  const scanA2 = await Scan.create({
    repositoryId: repoA._id,
    userId: userA._id,
    status: 'QUEUED',
    branch: 'master',
  });
  const scanIdA2 = scanA2._id;

  // -------------------------------------------------------------
  // Test 3: User cannot create scan for another user's repository
  // -------------------------------------------------------------
  console.log('\nTEST 3: User A attempting to create scan for User B’s repository returns 404');
  const crossCreateRes = await fetch(`http://localhost:5000/api/repositories/${repoB._id}/scans`, {
    method: 'POST',
    headers: authHeadersA,
  });
  const crossCreateData = await crossCreateRes.json();
  console.log(`  Status: ${crossCreateRes.status} | Error: "${crossCreateData.error}"`);
  if (crossCreateRes.status !== 404) throw new Error('Expected 404 when creating scan for another user repo');

  // -------------------------------------------------------------
  // Test 4: Invalid repository ID handled correctly (404)
  // -------------------------------------------------------------
  console.log('\nTEST 4: Invalid repository ID format returns 404');
  const invalidRepoRes = await fetch('http://localhost:5000/api/repositories/invalid-repo-id-123/scans', {
    method: 'POST',
    headers: authHeadersA,
  });
  const invalidRepoData = await invalidRepoRes.json();
  console.log(`  Status: ${invalidRepoRes.status} | Error: "${invalidRepoData.error}"`);
  if (invalidRepoRes.status !== 404) throw new Error('Expected 404 for invalid repository ID');

  // -------------------------------------------------------------
  // Test 5: User can retrieve own scan status
  // -------------------------------------------------------------
  console.log('\nTEST 5: User retrieves own scan details by scan ID');
  const getScanRes = await fetch(`http://localhost:5000/api/repositories/${repoA._id}/scans/${scanIdA1}`, {
    headers: authHeadersA,
  });
  const getScanData = await getScanRes.json();
  console.log(`  Status: ${getScanRes.status} | Scan Status: ${getScanData.scan?.status} | Repo ID: ${getScanData.scan?.repositoryId}`);
  if (getScanRes.status !== 200 || !getScanData.success || getScanData.scan._id !== scanIdA1) {
    throw new Error('Get own scan failed');
  }

  // -------------------------------------------------------------
  // Test 6: User can retrieve scan history for own repository
  // -------------------------------------------------------------
  console.log('\nTEST 6: User retrieves scan history for own repository (sorted newest-first)');
  const listScansRes = await fetch(`http://localhost:5000/api/repositories/${repoA._id}/scans`, {
    headers: authHeadersA,
  });
  const listScansData = await listScansRes.json();
  console.log(`  Status: ${listScansRes.status} | Total Scans: ${listScansData.total} | Scans Returned: ${listScansData.scans?.length}`);
  console.log(`  Newest scan in list: ${listScansData.scans[0]?._id}`);
  if (listScansRes.status !== 200 || listScansData.total !== 2 || listScansData.scans[0]._id !== scanIdA2.toString()) {
    throw new Error('List scan history failed or sorting incorrect');
  }

  // -------------------------------------------------------------
  // Test 7: User A cannot retrieve User B's repository scan history
  // -------------------------------------------------------------
  console.log('\nTEST 7: User A attempting to list User B’s repository scans returns 404');
  const crossListRes = await fetch(`http://localhost:5000/api/repositories/${repoB._id}/scans`, {
    headers: authHeadersA,
  });
  const crossListData = await crossListRes.json();
  console.log(`  Status: ${crossListRes.status} | Error: "${crossListData.error}"`);
  if (crossListRes.status !== 404) throw new Error('Expected 404 when listing another user repo scans');

  // -------------------------------------------------------------
  // Test 8: User A cannot retrieve User B's scan details
  // -------------------------------------------------------------
  console.log('\nTEST 8: User A attempting to get User B’s scan details returns 404');
  // Create scan for User B first
  const scanB = await Scan.create({
    repositoryId: repoB._id,
    userId: userB._id,
    status: 'QUEUED',
    branch: 'main',
  });

  const crossGetScanRes = await fetch(`http://localhost:5000/api/repositories/${repoB._id}/scans/${scanB._id}`, {
    headers: authHeadersA,
  });
  const crossGetScanData = await crossGetScanRes.json();
  console.log(`  Status: ${crossGetScanRes.status} | Error: "${crossGetScanData.error}"`);
  if (crossGetScanRes.status !== 404) throw new Error('Expected 404 when getting another user scan');

  // -------------------------------------------------------------
  // Test 9: Invalid scan ID returns 404
  // -------------------------------------------------------------
  console.log('\nTEST 9: Invalid scan ID returns 404');
  const invalidScanRes = await fetch(`http://localhost:5000/api/repositories/${repoA._id}/scans/invalid-scan-id-456`, {
    headers: authHeadersA,
  });
  const invalidScanData = await invalidScanRes.json();
  console.log(`  Status: ${invalidScanRes.status} | Error: "${invalidScanData.error}"`);
  if (invalidScanRes.status !== 404) throw new Error('Expected 404 for invalid scan ID');

  // Clean up
  await User.deleteMany({ email: { $in: [userAEmail, userBEmail] } });
  await Repository.deleteMany({ _id: { $in: [repoA._id, repoB._id] } });
  await Scan.deleteMany({ _id: { $in: [scanIdA1, scanIdA2, scanB._id] } });
  await mongoose.disconnect();

  console.log('\n=============================================================');
  console.log('  ALL PHASE 3D TESTS PASSED SUCCESSFULLY! (9/9)');
  console.log('=============================================================\n');
}

runPhase3DTests().catch((err) => {
  console.error('\n❌ Phase 3D Test Error:', err);
  process.exit(1);
});
