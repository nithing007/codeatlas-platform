/**
 * Phase 5B.2 — Backend Analyzer Service Test Suite
 *
 * Tests backend/src/services/analyzerService.js using a lightweight mock HTTP
 * server (http.createServer) to simulate the analyzer. No external process,
 * no Docker, no real analyzer required.
 *
 * Coverage:
 * 15. Correct request URL is sent to the analyzer.
 * 16. Internal authentication header is included.
 * 17. Correct repository / branch / commitSha payload is sent.
 * 18. Successful analyzer response is returned to caller.
 * 19. Analyzer 4xx response (400) becomes a controlled backend error.
 * 20. Analyzer 5xx response (500) becomes a controlled backend error.
 * 21. Analyzer connection failure (ECONNREFUSED) becomes a controlled error.
 * 22. Analyzer timeout becomes a controlled error.
 * 23. Malformed analyzer response (missing required keys) is rejected.
 * 24. Internal token is NOT present in thrown error messages.
 *
 * Run: node scratch/test_phase5b2.js
 */

require('dotenv').config();

const http = require('http');

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

async function assertRejects(fn, testName) {
  try {
    await fn();
    console.error(`  [FAIL] ${testName} — expected error but none was thrown`);
    failures.push(`${testName} — expected error but none was thrown`);
    failed++;
    return null;
  } catch (err) {
    console.log(`  [PASS] ${testName}`);
    passed++;
    return err;
  }
}

// ---------------------------------------------------------------------------
// Mock analyzer server helpers
// ---------------------------------------------------------------------------

/**
 * Starts a minimal HTTP server that captures the incoming request and returns
 * the provided status/body.
 *
 * @param {number} statusCode
 * @param {object|string} responseBody
 * @returns {Promise<{ port: number, captured: { method, url, headers, body }, close: Function }>}
 */
function startMockAnalyzer(statusCode, responseBody) {
  return new Promise((resolve, reject) => {
    const captured = {};
    const server = http.createServer((req, res) => {
      captured.method = req.method;
      captured.url = req.url;
      captured.headers = req.headers;

      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        try { captured.body = JSON.parse(raw); } catch { captured.body = raw; }

        const bodyStr = JSON.stringify(responseBody);
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(bodyStr);
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const close = () => new Promise((res) => server.close(res));
      resolve({ port, captured, close });
    });
    server.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// analyzerService factory
// ---------------------------------------------------------------------------

/**
 * Loads a fresh instance of analyzerService with overridden config values.
 * We override config fields directly on the imported module to avoid reloading.
 */
function makeService({ analyzerUrl, analyzerInternalToken, analyzerTimeoutMs = 5000 }) {
  // Bust the service cache to pick up any re-configuration
  const configPath = require.resolve('../src/config');
  const servicePath = require.resolve('../src/services/analyzerService');
  delete require.cache[configPath];
  delete require.cache[servicePath];

  // Override env so config picks up fresh values
  process.env.ANALYZER_URL = analyzerUrl;
  process.env.ANALYZER_INTERNAL_TOKEN = analyzerInternalToken;
  process.env.ANALYZER_TIMEOUT_MS = String(analyzerTimeoutMs);

  return require('../src/services/analyzerService');
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const TEST_TOKEN = 'backend-test-internal-token-xyz';

const VALID_PARAMS = {
  repository: 'expressjs/express',
  branch: 'main',
  commitSha: 'a'.repeat(40),
};

const VALID_ANALYZER_RESPONSE = {
  repository: { owner: 'expressjs', name: 'express', fullName: 'expressjs/express', branch: 'main', commitSha: 'a'.repeat(40) },
  statistics: { totalFiles: 10 },
  importantFiles: {},
  files: [],
  facts: { codeFacts: {}, documentationFacts: {}, warnings: [] },
  drift: { summary: { total: 0, high: 0, medium: 0, low: 0 }, findings: [] },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function runTests() {
  console.log('\n=============================================================');
  console.log('  Phase 5B.2 — Backend Analyzer Service Test Suite');
  console.log('=============================================================\n');

  // -------------------------------------------------------------------------
  // TEST 15 — Correct request URL is sent
  // -------------------------------------------------------------------------
  console.log('Group 1: Request construction');
  {
    const { port, captured, close } = await startMockAnalyzer(200, VALID_ANALYZER_RESPONSE);
    const service = makeService({ analyzerUrl: `http://127.0.0.1:${port}`, analyzerInternalToken: TEST_TOKEN });
    try {
      await service.analyze(VALID_PARAMS);
      assert(captured.url === '/api/analyze', 'TEST 15: Correct URL /api/analyze sent to analyzer');
      assert(captured.method === 'POST', 'TEST 15b: Method is POST');
    } finally {
      await close();
    }
  }

  // -------------------------------------------------------------------------
  // TEST 16 — Internal authentication header is sent
  // -------------------------------------------------------------------------
  {
    const { port, captured, close } = await startMockAnalyzer(200, VALID_ANALYZER_RESPONSE);
    const service = makeService({ analyzerUrl: `http://127.0.0.1:${port}`, analyzerInternalToken: TEST_TOKEN });
    try {
      await service.analyze(VALID_PARAMS);
      assert(
        captured.headers.authorization === `Bearer ${TEST_TOKEN}`,
        'TEST 16: Internal Authorization header sent correctly'
      );
    } finally {
      await close();
    }
  }

  // -------------------------------------------------------------------------
  // TEST 17 — Correct repository/branch/commitSha payload is sent
  // -------------------------------------------------------------------------
  {
    const { port, captured, close } = await startMockAnalyzer(200, VALID_ANALYZER_RESPONSE);
    const service = makeService({ analyzerUrl: `http://127.0.0.1:${port}`, analyzerInternalToken: TEST_TOKEN });
    try {
      await service.analyze(VALID_PARAMS);
      assert(captured.body.repository === 'expressjs/express', 'TEST 17a: repository field correct');
      assert(captured.body.branch === 'main', 'TEST 17b: branch field correct');
      assert(captured.body.commitSha === 'a'.repeat(40), 'TEST 17c: commitSha field correct');
    } finally {
      await close();
    }
  }

  // -------------------------------------------------------------------------
  // TEST 18 — Successful analyzer response is returned
  // -------------------------------------------------------------------------
  console.log('\nGroup 2: Response handling');
  {
    const { port, close } = await startMockAnalyzer(200, VALID_ANALYZER_RESPONSE);
    const service = makeService({ analyzerUrl: `http://127.0.0.1:${port}`, analyzerInternalToken: TEST_TOKEN });
    try {
      const result = await service.analyze(VALID_PARAMS);
      assert(result.repository?.fullName === 'expressjs/express', 'TEST 18a: Successful result.repository returned');
      assert('statistics' in result, 'TEST 18b: result.statistics present');
      assert('facts' in result, 'TEST 18c: result.facts present');
      assert('drift' in result, 'TEST 18d: result.drift present');
    } finally {
      await close();
    }
  }

  // -------------------------------------------------------------------------
  // TEST 19 — Analyzer 400 → controlled backend error
  // -------------------------------------------------------------------------
  {
    const errBody = { error: { code: 'INVALID_ANALYSIS_REQUEST', message: 'repository is required' } };
    const { port, close } = await startMockAnalyzer(400, errBody);
    const service = makeService({ analyzerUrl: `http://127.0.0.1:${port}`, analyzerInternalToken: TEST_TOKEN });
    try {
      const err = await assertRejects(() => service.analyze(VALID_PARAMS), 'TEST 19: Analyzer 400 → controlled error');
      if (err) {
        assert(err.statusCode === 400, 'TEST 19b: Error statusCode is 400');
        assert(err.isAnalyzerError === true, 'TEST 19c: isAnalyzerError flag set');
      }
    } finally {
      await close();
    }
  }

  // -------------------------------------------------------------------------
  // TEST 20 — Analyzer 500 → controlled backend error
  // -------------------------------------------------------------------------
  {
    const { port, close } = await startMockAnalyzer(500, { error: { code: 'ANALYSIS_FAILED' } });
    const service = makeService({ analyzerUrl: `http://127.0.0.1:${port}`, analyzerInternalToken: TEST_TOKEN });
    try {
      const err = await assertRejects(() => service.analyze(VALID_PARAMS), 'TEST 20: Analyzer 500 → controlled error');
      if (err) {
        assert(err.statusCode === 502, 'TEST 20b: Error statusCode is 502 (upstream error)');
        assert(err.isAnalyzerError === true, 'TEST 20c: isAnalyzerError flag set');
      }
    } finally {
      await close();
    }
  }

  // -------------------------------------------------------------------------
  // TEST 21 — Connection failure → controlled error
  // -------------------------------------------------------------------------
  console.log('\nGroup 3: Failure and resilience');
  {
    // Use a port we know is not listening (high port unlikely to be in use)
    const service = makeService({
      analyzerUrl: 'http://127.0.0.1:19999',
      analyzerInternalToken: TEST_TOKEN,
      analyzerTimeoutMs: 3000,
    });
    const err = await assertRejects(() => service.analyze(VALID_PARAMS), 'TEST 21: Connection failure → controlled error');
    if (err) {
      assert(err.isAnalyzerError === true, 'TEST 21b: isAnalyzerError flag set');
      assert(err.statusCode === 503, 'TEST 21c: statusCode is 503');
    }
  }

  // -------------------------------------------------------------------------
  // TEST 22 — Analyzer timeout → controlled error
  // -------------------------------------------------------------------------
  {
    // Mock server that hangs (never responds)
    const hangingServer = http.createServer(() => { /* never respond */ });
    await new Promise((res) => hangingServer.listen(0, '127.0.0.1', res));
    const hangPort = hangingServer.address().port;

    const service = makeService({
      analyzerUrl: `http://127.0.0.1:${hangPort}`,
      analyzerInternalToken: TEST_TOKEN,
      analyzerTimeoutMs: 300, // Very short timeout for test speed
    });

    try {
      const err = await assertRejects(() => service.analyze(VALID_PARAMS), 'TEST 22: Analyzer timeout → controlled error');
      if (err) {
        assert(err.isAnalyzerError === true, 'TEST 22b: isAnalyzerError flag set');
        assert(err.statusCode === 504, 'TEST 22c: statusCode is 504');
      }
    } finally {
      await new Promise((res) => hangingServer.close(res));
    }
  }

  // -------------------------------------------------------------------------
  // TEST 23 — Malformed response (missing required keys) is rejected
  // -------------------------------------------------------------------------
  {
    const malformedBody = { someRandomField: 'value' }; // Missing repository, statistics, facts, drift
    const { port, close } = await startMockAnalyzer(200, malformedBody);
    const service = makeService({ analyzerUrl: `http://127.0.0.1:${port}`, analyzerInternalToken: TEST_TOKEN });
    try {
      const err = await assertRejects(() => service.analyze(VALID_PARAMS), 'TEST 23: Malformed response missing required keys → rejected');
      if (err) {
        assert(err.isAnalyzerError === true, 'TEST 23b: isAnalyzerError flag set');
      }
    } finally {
      await close();
    }
  }

  // -------------------------------------------------------------------------
  // TEST 24 — Internal token is NOT leaked in error messages
  // -------------------------------------------------------------------------
  {
    // Auth rejection response
    const { port, close } = await startMockAnalyzer(401, { error: { code: 'UNAUTHORIZED' } });
    const service = makeService({ analyzerUrl: `http://127.0.0.1:${port}`, analyzerInternalToken: TEST_TOKEN });
    try {
      const err = await assertRejects(() => service.analyze(VALID_PARAMS), 'TEST 24: Token not in error (assertRejects)');
      if (err) {
        assert(!err.message.includes(TEST_TOKEN), 'TEST 24b: Internal token NOT in error message');
        assert(!String(err.stack || '').includes(TEST_TOKEN), 'TEST 24c: Internal token NOT in error stack');
      }
    } finally {
      await close();
    }
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

  console.log('All Phase 5B.2 Backend Analyzer Service tests passed.\n');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
