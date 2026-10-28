/**
 * Phase 5B.2 — Analyzer HTTP Service Test Suite
 *
 * Tests the analyzer's Express HTTP application in-process.
 * The app is started on a random available port; no external process needed.
 *
 * Coverage:
 *  1.  GET /api/health → 200, { status: 'ok', service: 'analyzer' }
 *  2.  POST /api/analyze with valid token + mock scanner → 200 with expected structure
 *  3.  POST /api/analyze — missing Authorization header → 401
 *  4.  POST /api/analyze — invalid token → 401
 *  5.  POST /api/analyze — correct token accepted (200)
 *  6.  POST /api/analyze — missing repository → 400
 *  7.  POST /api/analyze — invalid repository format (URL) → 400
 *  8.  POST /api/analyze — missing branch → 400
 *  9.  POST /api/analyze — invalid commitSha → 400
 * 10.  POST /api/analyze — valid request routes to scanner (mock invocation verified)
 * 11.  POST /api/analyze — result preserves expected top-level structure
 * 12.  POST /api/analyze — scanner error → 500, controlled message
 * 13.  GET  /api/health  — no secrets or tokens in response
 * 14.  POST /api/analyze — child_process is NOT used (static verification)
 *
 * Run: node tests/phase5b2.test.js
 */

'use strict';

const http = require('http');
const path = require('path');
const fs   = require('fs');

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

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

/**
 * Makes an HTTP request to the in-process test server.
 *
 * @param {Object} options
 * @param {string}  options.method
 * @param {string}  options.path
 * @param {number}  options.port
 * @param {Object}  [options.headers]
 * @param {Object|null} [options.body]
 * @returns {Promise<{ status: number, body: any }>}
 */
function request({ method, path: reqPath, port, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers,
    };
    if (bodyStr) {
      reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = http.request(
      { hostname: '127.0.0.1', port, path: reqPath, method, headers: reqHeaders },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(raw); } catch { parsed = raw; }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Test token and valid request fixture
// ---------------------------------------------------------------------------

const TEST_TOKEN = 'test-internal-token-phase5b2';

const VALID_COMMIT_SHA = 'a'.repeat(40);

const VALID_REQUEST = {
  repository: 'expressjs/express',
  branch: 'main',
  commitSha: VALID_COMMIT_SHA,
};

// ---------------------------------------------------------------------------
// Mock RepositoryScanner injection
// ---------------------------------------------------------------------------

/**
 * Starts the analyzer app with a mock RepositoryScanner pre-injected.
 * Clears all relevant caches BEFORE loading the app so the controller
 * captures the mock class rather than the real one.
 *
 * @param {string} token
 * @param {object} mockResult - The result the mock scanner.scan() returns.
 * @returns {Promise<{ port: number, closeServer: Function }>}
 */
async function startAppWithMock(token, mockResult) {
  process.env.ANALYZER_INTERNAL_TOKEN = token;

  // Clear all caches in dependency order (scanner first, then dependents)
  const scannerPath = require.resolve('../src/scanner/repositoryScanner');
  const configPath = require.resolve('../src/config');
  const controllerPath = require.resolve('../src/controllers/analysisController');
  const routerPath = require.resolve('../src/routes/analysisRoutes');
  const authPath = require.resolve('../src/middleware/internalAuth');
  const appPath = require.resolve('../src/app');

  delete require.cache[configPath];
  delete require.cache[controllerPath];
  delete require.cache[routerPath];
  delete require.cache[authPath];
  delete require.cache[appPath];

  // Inject mock AFTER clearing controller cache but BEFORE requiring it
  const originalScanner = require.cache[scannerPath];
  require.cache[scannerPath] = {
    id: scannerPath, filename: scannerPath, loaded: true,
    exports: class MockRepositoryScanner {
      async scan() { return mockResult; }
    },
  };

  let server;
  try {
    const app = require('../src/app');
    server = await new Promise((resolve, reject) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
      s.on('error', reject);
    });
  } finally {
    // Restore the real scanner in cache
    if (originalScanner) {
      require.cache[scannerPath] = originalScanner;
    } else {
      delete require.cache[scannerPath];
    }
  }

  const port = server.address().port;
  const closeServer = () => new Promise((res) => server.close(res));
  return { port, closeServer };
}

// ---------------------------------------------------------------------------
// Minimal valid analysis result
// ---------------------------------------------------------------------------

const MOCK_RESULT = {
  repository: { owner: 'expressjs', name: 'express', fullName: 'expressjs/express', branch: 'main', commitSha: VALID_COMMIT_SHA },
  statistics: { totalFiles: 5, sourceFiles: 3, documentationFiles: 1, configurationFiles: 1 },
  importantFiles: {},
  files: [],
  facts: {
    codeFacts: { apiEndpoints: [], environmentVariables: [], dependencies: [], scripts: [] },
    documentationFacts: { apiEndpoints: [], environmentVariables: [] },
    warnings: [],
  },
  drift: {
    summary: { total: 0, high: 0, medium: 0, low: 0 },
    findings: [],
  },
};

// ---------------------------------------------------------------------------
// Server lifecycle helpers
// ---------------------------------------------------------------------------

/**
 * Starts the analyzer app on a random available port with the given
 * ANALYZER_INTERNAL_TOKEN overriding config.
 *
 * @param {string} token
 * @returns {Promise<{ server: http.Server, port: number, closeServer: Function }>}
 */
async function startApp(token) {
  // Override the config token before importing app
  process.env.ANALYZER_INTERNAL_TOKEN = token;

  // Clear module cache so each test group gets fresh config/app instances
  const configPath = require.resolve('../src/config');
  delete require.cache[configPath];
  const controllerPath = require.resolve('../src/controllers/analysisController');
  delete require.cache[controllerPath];
  const routerPath = require.resolve('../src/routes/analysisRoutes');
  delete require.cache[routerPath];
  const authPath = require.resolve('../src/middleware/internalAuth');
  delete require.cache[authPath];
  const appPath = require.resolve('../src/app');
  delete require.cache[appPath];

  const app = require('../src/app');

  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const closeServer = () => new Promise((res) => server.close(res));
      resolve({ server, port, closeServer });
    });
    server.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function runTests() {
  console.log('\n=============================================================');
  console.log('  Phase 5B.2 — Analyzer HTTP Service Test Suite');
  console.log('=============================================================\n');

  // -------------------------------------------------------------------------
  // TEST 1 — GET /api/health → 200
  // -------------------------------------------------------------------------
  console.log('Group 1: Health endpoint');
  {
    const { port, closeServer } = await startApp(TEST_TOKEN);
    try {
      const res = await request({ method: 'GET', path: '/api/health', port });
      assert(res.status === 200, 'TEST 1: GET /api/health returns 200');
      assert(res.body.status === 'ok', 'TEST 1b: health body.status === "ok"');
      assert(res.body.service === 'analyzer', 'TEST 1c: health body.service === "analyzer"');
    } finally {
      await closeServer();
    }
  }

  // -------------------------------------------------------------------------
  // TEST 2 — Valid token + mock scanner → 200 with expected structure
  // -------------------------------------------------------------------------
  console.log('\nGroup 2: Authentication');
  {
    const { port, closeServer } = await startAppWithMock(TEST_TOKEN, MOCK_RESULT);
    try {
      const res = await request({
        method: 'POST',
        path: '/api/analyze',
        port,
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
        body: VALID_REQUEST,
      });
      assert(res.status === 200, 'TEST 2: Valid token + mock scanner → 200');
    } finally {
      await closeServer();
    }
  }

  // -------------------------------------------------------------------------
  // TEST 3 — Missing Authorization header → 401
  // -------------------------------------------------------------------------
  {
    const { port, closeServer } = await startApp(TEST_TOKEN);
    try {
      const res = await request({
        method: 'POST',
        path: '/api/analyze',
        port,
        body: VALID_REQUEST,
      });
      assert(res.status === 401, 'TEST 3: Missing Authorization header → 401');
    } finally {
      await closeServer();
    }
  }

  // -------------------------------------------------------------------------
  // TEST 4 — Invalid token → 401
  // -------------------------------------------------------------------------
  {
    const { port, closeServer } = await startApp(TEST_TOKEN);
    try {
      const res = await request({
        method: 'POST',
        path: '/api/analyze',
        port,
        headers: { Authorization: 'Bearer wrong-token-here' },
        body: VALID_REQUEST,
      });
      assert(res.status === 401, 'TEST 4: Invalid token → 401');
      assert(!JSON.stringify(res.body).includes(TEST_TOKEN), 'TEST 4b: Expected token not in response');
    } finally {
      await closeServer();
    }
  }

  // -------------------------------------------------------------------------
  // TEST 5 — Correct token is accepted
  // -------------------------------------------------------------------------
  {
    const { port, closeServer } = await startAppWithMock(TEST_TOKEN, MOCK_RESULT);
    try {
      const res = await request({
        method: 'POST',
        path: '/api/analyze',
        port,
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
        body: VALID_REQUEST,
      });
      assert(res.status === 200, 'TEST 5: Correct token is accepted (200)');
    } finally {
      await closeServer();
    }
  }

  // -------------------------------------------------------------------------
  // TEST 6 — Missing repository → 400
  // -------------------------------------------------------------------------
  console.log('\nGroup 3: Request validation');
  {
    const { port, closeServer } = await startApp(TEST_TOKEN);
    try {
      const res = await request({
        method: 'POST',
        path: '/api/analyze',
        port,
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
        body: { branch: 'main', commitSha: VALID_COMMIT_SHA },
      });
      assert(res.status === 400, 'TEST 6: Missing repository → 400');
      assert(res.body.error?.code === 'INVALID_ANALYSIS_REQUEST', 'TEST 6b: Error code correct');
    } finally {
      await closeServer();
    }
  }

  // -------------------------------------------------------------------------
  // TEST 7 — Invalid repository format (URL) → 400
  // -------------------------------------------------------------------------
  {
    const { port, closeServer } = await startApp(TEST_TOKEN);
    try {
      const res = await request({
        method: 'POST',
        path: '/api/analyze',
        port,
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
        body: { repository: 'https://github.com/expressjs/express', branch: 'main', commitSha: VALID_COMMIT_SHA },
      });
      assert(res.status === 400, 'TEST 7: URL-format repository → 400');
    } finally {
      await closeServer();
    }
  }

  // -------------------------------------------------------------------------
  // TEST 8 — Missing branch → 400
  // -------------------------------------------------------------------------
  {
    const { port, closeServer } = await startApp(TEST_TOKEN);
    try {
      const res = await request({
        method: 'POST',
        path: '/api/analyze',
        port,
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
        body: { repository: 'expressjs/express', commitSha: VALID_COMMIT_SHA },
      });
      assert(res.status === 400, 'TEST 8: Missing branch → 400');
    } finally {
      await closeServer();
    }
  }

  // -------------------------------------------------------------------------
  // TEST 9 — Invalid commitSha → 400
  // -------------------------------------------------------------------------
  {
    const { port, closeServer } = await startApp(TEST_TOKEN);
    try {
      const res = await request({
        method: 'POST',
        path: '/api/analyze',
        port,
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
        body: { repository: 'expressjs/express', branch: 'main', commitSha: 'not-a-sha' },
      });
      assert(res.status === 400, 'TEST 9: Invalid commitSha → 400');
    } finally {
      await closeServer();
    }
  }

  // -------------------------------------------------------------------------
  // TEST 10 — Valid request reaches scanner (mock invocation verified)
  // -------------------------------------------------------------------------
  console.log('\nGroup 4: Scanner integration');
  {
    let scanCalled = false;
    let receivedOwner, receivedRepo, receivedBranch;

    // Build a spy-result so we can capture the invocation arguments
    process.env.ANALYZER_INTERNAL_TOKEN = TEST_TOKEN;
    const scannerPath = require.resolve('../src/scanner/repositoryScanner');
    const configPath = require.resolve('../src/config');
    const controllerPath = require.resolve('../src/controllers/analysisController');
    const routerPath = require.resolve('../src/routes/analysisRoutes');
    const authPath = require.resolve('../src/middleware/internalAuth');
    const appPath = require.resolve('../src/app');

    delete require.cache[configPath];
    delete require.cache[controllerPath];
    delete require.cache[routerPath];
    delete require.cache[authPath];
    delete require.cache[appPath];

    const originalScanner = require.cache[scannerPath];
    require.cache[scannerPath] = {
      id: scannerPath, filename: scannerPath, loaded: true,
      exports: class SpyScanner {
        async scan(o, r, b) {
          scanCalled = true;
          receivedOwner = o; receivedRepo = r; receivedBranch = b;
          return MOCK_RESULT;
        }
      },
    };

    const app = require('../src/app');
    if (originalScanner) require.cache[scannerPath] = originalScanner;
    else delete require.cache[scannerPath];

    const server = await new Promise((res, rej) => { const s = app.listen(0, '127.0.0.1', () => res(s)); s.on('error', rej); });
    const port = server.address().port;
    const closeServer = () => new Promise((res) => server.close(res));

    try {
      const res = await request({
        method: 'POST',
        path: '/api/analyze',
        port,
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
        body: VALID_REQUEST,
      });
      assert(res.status === 200, 'TEST 10a: Valid request → 200');
      assert(scanCalled, 'TEST 10b: Scanner.scan() was called');
      assert(receivedOwner === 'expressjs', 'TEST 10c: Scanner received correct owner');
      assert(receivedRepo === 'express', 'TEST 10d: Scanner received correct repo');
      assert(receivedBranch === 'main', 'TEST 10e: Scanner received correct branch');
    } finally {
      await closeServer();
    }
  }

  // -------------------------------------------------------------------------
  // TEST 11 — Result preserves expected top-level structure
  // -------------------------------------------------------------------------
  {
    const { port, closeServer } = await startAppWithMock(TEST_TOKEN, MOCK_RESULT);
    try {
      const res = await request({
        method: 'POST',
        path: '/api/analyze',
        port,
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
        body: VALID_REQUEST,
      });
      assert('repository'   in res.body, 'TEST 11a: Response has "repository"');
      assert('statistics'   in res.body, 'TEST 11b: Response has "statistics"');
      assert('files'        in res.body, 'TEST 11c: Response has "files"');
      assert('facts'        in res.body, 'TEST 11d: Response has "facts"');
      assert('drift'        in res.body, 'TEST 11e: Response has "drift"');
    } finally {
      await closeServer();
    }
  }

  // -------------------------------------------------------------------------
  // TEST 12 — Scanner error → 500, controlled message
  // -------------------------------------------------------------------------
  console.log('\nGroup 5: Error handling and security');
  {
    process.env.ANALYZER_INTERNAL_TOKEN = TEST_TOKEN;
    const scannerPath = require.resolve('../src/scanner/repositoryScanner');
    const configPath = require.resolve('../src/config');
    const controllerPath = require.resolve('../src/controllers/analysisController');
    const routerPath = require.resolve('../src/routes/analysisRoutes');
    const authPath = require.resolve('../src/middleware/internalAuth');
    const appPath = require.resolve('../src/app');

    delete require.cache[configPath];
    delete require.cache[controllerPath];
    delete require.cache[routerPath];
    delete require.cache[authPath];
    delete require.cache[appPath];

    const originalScanner = require.cache[scannerPath];
    require.cache[scannerPath] = {
      id: scannerPath, filename: scannerPath, loaded: true,
      exports: class ErrorScanner {
        async scan() { throw new Error('Internal processing failure with /secret/path'); }
      },
    };

    const app = require('../src/app');
    if (originalScanner) require.cache[scannerPath] = originalScanner;
    else delete require.cache[scannerPath];

    const server = await new Promise((res, rej) => { const s = app.listen(0, '127.0.0.1', () => res(s)); s.on('error', rej); });
    const port = server.address().port;

    try {
      const res = await request({
        method: 'POST',
        path: '/api/analyze',
        port,
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
        body: VALID_REQUEST,
      });
      assert(res.status === 500, 'TEST 12a: Scanner error → 500');
      assert(res.body.error?.code === 'ANALYSIS_FAILED', 'TEST 12b: Error code is ANALYSIS_FAILED');
      const bodyStr = JSON.stringify(res.body);
      assert(!bodyStr.includes('/secret/path'), 'TEST 12c: Stack trace / path not in response');
    } finally {
      await new Promise((res) => server.close(res));
    }
  }

  // -------------------------------------------------------------------------
  // TEST 13 — No secrets or tokens in health response
  // -------------------------------------------------------------------------
  {
    const testToken = 'super-secret-internal-token-xyz';
    const { port, closeServer } = await startApp(testToken);
    try {
      const res = await request({ method: 'GET', path: '/api/health', port });
      const bodyStr = JSON.stringify(res.body);
      assert(!bodyStr.includes(testToken), 'TEST 13: Internal token not in health response');
      assert(!bodyStr.includes('ANALYZER_INTERNAL_TOKEN'), 'TEST 13b: Token env var name not in health response');
    } finally {
      await closeServer();
    }
  }

  // -------------------------------------------------------------------------
  // TEST 14 — child_process is not used in source files (static check)
  // -------------------------------------------------------------------------
  {
    const srcDir = path.join(__dirname, '..', 'src');
    const newFiles = [
      'app.js',
      'server.js',
      path.join('middleware', 'internalAuth.js'),
      path.join('routes', 'analysisRoutes.js'),
      path.join('controllers', 'analysisController.js'),
    ];
    let childProcessFound = false;
    for (const file of newFiles) {
      const fullPath = path.join(srcDir, file);
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        // Only flag actual require/import of child_process, not mentions in comments
        if (/require\s*\(['"]child_process['"]\)|import\s+.*from\s+['"]child_process['"]/.test(content)) {
          childProcessFound = true;
          console.error(`  child_process required in: ${file}`);
        }
      } catch {
        // File not found — skip
      }
    }
    assert(!childProcessFound, 'TEST 14: child_process is NOT required in analyzer HTTP service files');
  }

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

  console.log('All Phase 5B.2 Analyzer HTTP tests passed.\n');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
