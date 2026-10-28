require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Repository = require('../src/models/Repository');
const { generateToken } = require('../src/services/jwtService');
const config = require('../src/config');

async function runPhase3Tests() {
  console.log('\n================================================================');
  console.log('  Phase 3A–3C Repository Intake & GitHub Integration Test Suite');
  console.log('================================================================\n');

  await mongoose.connect(config.mongodbUri);

  // Setup Test Users
  const userAEmail = `user.a.${Date.now()}@example.com`;
  const userBEmail = `user.b.${Date.now()}@example.com`;

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

  // -------------------------------------------------------------
  // Test 1: Unauthenticated requests return 401 Unauthorized
  // -------------------------------------------------------------
  console.log('TEST 1: Unauthenticated request to /api/repositories returns 401');
  const unauthRes = await fetch('http://localhost:5000/api/repositories');
  const unauthData = await unauthRes.json();
  console.log(`  Status: ${unauthRes.status} | Error: "${unauthData.error}"`);
  if (unauthRes.status !== 401) throw new Error('Expected 401 on unauthenticated request');

  // -------------------------------------------------------------
  // Test 2: Preview valid public repository (with trailing slash and .git)
  // -------------------------------------------------------------
  console.log('\nTEST 2: Preview valid public GitHub repository with normalization (.git + slash)');
  const previewRes = await fetch('http://localhost:5000/api/repositories/preview', {
    method: 'POST',
    headers: authHeadersA,
    body: JSON.stringify({ repositoryUrl: 'https://github.com/expressjs/express.git/' }),
  });
  const previewData = await previewRes.json();
  console.log(`  Status: ${previewRes.status} | Success: ${previewData.success}`);
  console.log(`  Repo: ${previewData.repository?.fullName} | Owner: ${previewData.repository?.owner} | Default Branch: ${previewData.repository?.defaultBranch}`);
  if (previewRes.status !== 200 || !previewData.success || previewData.repository.fullName !== 'expressjs/express') {
    throw new Error('Preview public repository failed');
  }

  // -------------------------------------------------------------
  // Test 3: Invalid URL formats rejected (400 Bad Request)
  // -------------------------------------------------------------
  console.log('\nTEST 3: Rejection of invalid GitHub URLs');

  const invalidUrls = [
    { url: 'https://gitlab.com/expressjs/express', desc: 'Non-GitHub URL' },
    { url: 'https://github.com/expressjs', desc: 'GitHub Profile / Org URL' },
    { url: 'https://github.com/expressjs/express/issues/123', desc: 'GitHub Issue URL' },
    { url: 'https://github.com/pricing', desc: 'Reserved GitHub Path' },
    { url: 'not-a-valid-url-at-all', desc: 'Malformed string' },
  ];

  for (const { url, desc } of invalidUrls) {
    const res = await fetch('http://localhost:5000/api/repositories/preview', {
      method: 'POST',
      headers: authHeadersA,
      body: JSON.stringify({ repositoryUrl: url }),
    });
    const data = await res.json();
    console.log(`  - ${desc}: Status ${res.status} | "${data.error}"`);
    if (res.status !== 400) throw new Error(`Expected 400 for ${desc}`);
  }

  // -------------------------------------------------------------
  // Test 4: Non-existent repository returns 404
  // -------------------------------------------------------------
  console.log('\nTEST 4: Non-existent repository returns 404');
  const nonExistRes = await fetch('http://localhost:5000/api/repositories/preview', {
    method: 'POST',
    headers: authHeadersA,
    body: JSON.stringify({ repositoryUrl: 'https://github.com/codeatlas-nonexistent-owner-999/nonexistent-repo-999' }),
  });
  const nonExistData = await nonExistRes.json();
  console.log(`  Status: ${nonExistRes.status} | Error: "${nonExistData.error}"`);
  if (nonExistRes.status !== 404) throw new Error('Expected 404 for non-existent repo');

  // -------------------------------------------------------------
  // Test 5: Import public repository for User A
  // -------------------------------------------------------------
  console.log('\nTEST 5: Import public repository for User A');
  const importResA = await fetch('http://localhost:5000/api/repositories', {
    method: 'POST',
    headers: authHeadersA,
    body: JSON.stringify({ repositoryUrl: 'https://github.com/expressjs/express' }),
  });
  const importDataA = await importResA.json();
  console.log(`  Status: ${importResA.status} | ID: ${importDataA.repository?._id}`);
  console.log(`  Imported: ${importDataA.repository?.fullName} | User ID: ${importDataA.repository?.userId}`);
  if (importResA.status !== 201 || !importDataA.success) throw new Error('Import repository for User A failed');
  if (importDataA.repository.userId.toString() !== userA._id.toString()) {
    throw new Error('Imported repository userId does not match authenticated user');
  }

  const repoIdA = importDataA.repository._id;

  // -------------------------------------------------------------
  // Test 6: Duplicate Import for User A returns 409 Conflict
  // -------------------------------------------------------------
  console.log('\nTEST 6: Duplicate import for the same user returns 409 Conflict');
  const dupRes = await fetch('http://localhost:5000/api/repositories', {
    method: 'POST',
    headers: authHeadersA,
    body: JSON.stringify({ repositoryUrl: 'https://github.com/expressjs/express.git' }),
  });
  const dupData = await dupRes.json();
  console.log(`  Status: ${dupRes.status} | Error: "${dupData.error}"`);
  if (dupRes.status !== 409 || !dupData.error) throw new Error('Expected 409 on duplicate import');

  // -------------------------------------------------------------
  // Test 7: User B can also import the same public repository
  // -------------------------------------------------------------
  console.log('\nTEST 7: User B can import the same public repository independently');
  const importResB = await fetch('http://localhost:5000/api/repositories', {
    method: 'POST',
    headers: authHeadersB,
    body: JSON.stringify({ repositoryUrl: 'https://github.com/expressjs/express' }),
  });
  const importDataB = await importResB.json();
  console.log(`  Status: ${importResB.status} | ID: ${importDataB.repository?._id} | User ID: ${importDataB.repository?.userId}`);
  if (importResB.status !== 201 || !importDataB.success) throw new Error('Import repository for User B failed');
  if (importDataB.repository.userId.toString() !== userB._id.toString()) {
    throw new Error('User B repo userId mismatch');
  }

  const repoIdB = importDataB.repository._id;

  // -------------------------------------------------------------
  // Test 8: List repositories returns strictly the user's repositories
  // -------------------------------------------------------------
  console.log('\nTEST 8: List repositories returns only the authenticated user’s repositories');
  const listResA = await fetch('http://localhost:5000/api/repositories', { headers: authHeadersA });
  const listDataA = await listResA.json();
  console.log(`  User A Repo Count: ${listDataA.count} | First Repo: ${listDataA.repositories[0]?.fullName} (ID: ${listDataA.repositories[0]?._id})`);

  const listResB = await fetch('http://localhost:5000/api/repositories', { headers: authHeadersB });
  const listDataB = await listResB.json();
  console.log(`  User B Repo Count: ${listDataB.count} | First Repo: ${listDataB.repositories[0]?.fullName} (ID: ${listDataB.repositories[0]?._id})`);

  if (listDataA.count !== 1 || listDataA.repositories[0]._id !== repoIdA) {
    throw new Error('User A list mismatch');
  }
  if (listDataB.count !== 1 || listDataB.repositories[0]._id !== repoIdB) {
    throw new Error('User B list mismatch');
  }

  // -------------------------------------------------------------
  // Test 9: Get repository details by ID (Owned repository)
  // -------------------------------------------------------------
  console.log('\nTEST 9: GET /api/repositories/:id for owned repository');
  const getResA = await fetch(`http://localhost:5000/api/repositories/${repoIdA}`, { headers: authHeadersA });
  const getDataA = await getResA.json();
  console.log(`  Status: ${getResA.status} | Full Name: ${getDataA.repository?.fullName}`);
  if (getResA.status !== 200 || getDataA.repository._id !== repoIdA) {
    throw new Error('Get owned repository failed');
  }

  // -------------------------------------------------------------
  // Test 10: Accessing another user's repository returns 404
  // -------------------------------------------------------------
  console.log('\nTEST 10: User A attempting to access User B’s repository returns 404');
  const crossGetRes = await fetch(`http://localhost:5000/api/repositories/${repoIdB}`, { headers: authHeadersA });
  const crossGetData = await crossGetRes.json();
  console.log(`  Status: ${crossGetRes.status} | Error: "${crossGetData.error}"`);
  if (crossGetRes.status !== 404) throw new Error('Expected 404 when accessing another user’s repository');

  // -------------------------------------------------------------
  // Test 11: Deleting another user's repository returns 404
  // -------------------------------------------------------------
  console.log('\nTEST 11: User A attempting to delete User B’s repository returns 404');
  const crossDelRes = await fetch(`http://localhost:5000/api/repositories/${repoIdB}`, {
    method: 'DELETE',
    headers: authHeadersA,
  });
  const crossDelData = await crossDelRes.json();
  console.log(`  Status: ${crossDelRes.status} | Error: "${crossDelData.error}"`);
  if (crossDelRes.status !== 404) throw new Error('Expected 404 when deleting another user’s repository');

  // -------------------------------------------------------------
  // Test 12: Delete repository removes CodeAtlas association only
  // -------------------------------------------------------------
  console.log('\nTEST 12: User A deletes their repository association');
  const delResA = await fetch(`http://localhost:5000/api/repositories/${repoIdA}`, {
    method: 'DELETE',
    headers: authHeadersA,
  });
  const delDataA = await delResA.json();
  console.log(`  Status: ${delResA.status} | Message: "${delDataA.message}"`);
  if (delResA.status !== 200 || !delDataA.success) throw new Error('Delete repository failed');

  // Verify User A has 0 repos, User B still has 1 repo
  const checkListA = await (await fetch('http://localhost:5000/api/repositories', { headers: authHeadersA })).json();
  const checkListB = await (await fetch('http://localhost:5000/api/repositories', { headers: authHeadersB })).json();
  console.log(`  User A Repos remaining: ${checkListA.count} | User B Repos remaining: ${checkListB.count}`);
  if (checkListA.count !== 0 || checkListB.count !== 1) {
    throw new Error('Repository deletion isolation failed');
  }

  // Clean up
  await User.deleteMany({ email: { $in: [userAEmail, userBEmail] } });
  await Repository.deleteMany({ _id: { $in: [repoIdA, repoIdB] } });
  await mongoose.disconnect();

  console.log('\n================================================================');
  console.log('  ALL PHASE 3A–3C TESTS PASSED SUCCESSFULLY! (12/12)');
  console.log('================================================================\n');
}

runPhase3Tests().catch((err) => {
  console.error('\n❌ Phase 3 Test Error:', err);
  process.exit(1);
});
