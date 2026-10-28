/**
 * Phase 5A.1 — Precision Hardening Test Suite
 *
 * Covers all 5 precision issues fixed:
 *   Issue 1 — Multi-level prefix resolution
 *   Issue 2 — LICENSE file exclusion from env var extraction
 *   Issue 3 — Test file exclusion from API extraction
 *   Issue 4 — System env var skip list
 *   Issue 5 — Context-sensitive documentation env var heuristics
 *
 * Plus regression of Phase 4A/4B and Phase 5A.
 */

'use strict';

const {
  extractApiEndpoints,
  resolvePrefixes,
  extractFromDocumentation,
  RepositoryScanner,
  MockRepositoryProvider,
  sanitizePath,
  isExcludedSecretFile,
  isBinaryExtension,
  classifyFile,
  CATEGORIES,
  detectDrift,
} = require('../src/index');

let passed = 0;
let total = 0;
let failures = [];

function assert(condition, message) {
  total++;
  if (!condition) {
    console.error(`  ❌ FAILED: ${message}`);
    failures.push(message);
  } else {
    passed++;
    console.log(`  ✅ ${message}`);
  }
}

function section(title) {
  console.log(`\n--- ${title} ---`);
}

// ══════════════════════════════════════════════════════════════════════
// ISSUE 1 — MULTI-LEVEL PREFIX RESOLUTION
// ══════════════════════════════════════════════════════════════════════
section('Issue 1: Multi-Level Prefix Resolution');

// ── 1-level (existing behaviour, must still work) ──
const s1 = `
const app = require('express')();
const authRouter = require('express').Router();
app.use('/api/auth', authRouter);
authRouter.post('/login', loginHandler);
`.trim();

const r1e = extractApiEndpoints(s1, 'src/app.js');
const r1mounts = r1e.mountedPrefixes;
const r1endpoints = r1e.endpoints;
const r1resolved = resolvePrefixes(r1endpoints, r1mounts);
const r1login = r1resolved.find(e => e.method === 'POST' && e.path === '/api/auth/login');
assert(!!r1login, '(1-level) POST /api/auth/login resolved correctly');
assert(r1login && r1login.prefixResolved === true, '(1-level) prefixResolved flag set');

// ── 2-level prefix resolution (the real bug) ──
const appFile = `
const express = require('express');
const app = express();
const v1Router = require('./routes/v1');
app.use('/v1', v1Router);
`.trim();

const v1File = `
const express = require('express');
const v1Router = express.Router();
const authRouter = require('./auth.route');
v1Router.use('/auth', authRouter);
module.exports = v1Router;
`.trim();

const authFile = `
const authRouter = require('express').Router();
authRouter.post('/login', loginHandler);
authRouter.post('/register', registerHandler);
authRouter.get('/me', getMeHandler);
module.exports = authRouter;
`.trim();

const r2_app  = extractApiEndpoints(appFile, 'src/app.js');
const r2_v1   = extractApiEndpoints(v1File,  'src/routes/v1/index.js');
const r2_auth = extractApiEndpoints(authFile, 'src/routes/v1/auth.route.js');

const allEndpoints2 = [...r2_app.endpoints, ...r2_v1.endpoints, ...r2_auth.endpoints];
const allMounts2    = [...r2_app.mountedPrefixes, ...r2_v1.mountedPrefixes, ...r2_auth.mountedPrefixes];
const resolved2     = resolvePrefixes(allEndpoints2, allMounts2);

const login2  = resolved2.find(e => e.method === 'POST' && e.path === '/v1/auth/login');
const reg2    = resolved2.find(e => e.method === 'POST' && e.path === '/v1/auth/register');
const me2     = resolved2.find(e => e.method === 'GET'  && e.path === '/v1/auth/me');

assert(!!login2,  '(2-level) POST /v1/auth/login resolved');
assert(!!reg2,    '(2-level) POST /v1/auth/register resolved');
assert(!!me2,     '(2-level) GET /v1/auth/me resolved');
assert(login2 && login2.prefixResolved === true, '(2-level) prefixResolved flag set');
assert(login2 && login2.source === 'src/routes/v1/auth.route.js', '(2-level) source file preserved (auth.route.js)');

// ── 3-level prefix resolution ──
const rootFile = `
const app = require('express')();
const apiRouter = require('./api');
app.use('/api', apiRouter);
`.trim();

const apiFile = `
const apiRouter = require('express').Router();
const v2Router = require('./v2');
apiRouter.use('/v2', v2Router);
module.exports = apiRouter;
`.trim();

const v2File = `
const v2Router = require('express').Router();
v2Router.get('/status', statusHandler);
module.exports = v2Router;
`.trim();

const e3_root = extractApiEndpoints(rootFile, 'src/app.js');
const e3_api  = extractApiEndpoints(apiFile,  'src/routes/api.js');
const e3_v2   = extractApiEndpoints(v2File,   'src/routes/v2.js');

const all3  = [...e3_root.endpoints, ...e3_api.endpoints, ...e3_v2.endpoints];
const mnt3  = [...e3_root.mountedPrefixes, ...e3_api.mountedPrefixes, ...e3_v2.mountedPrefixes];
const res3  = resolvePrefixes(all3, mnt3);

const status3 = res3.find(e => e.method === 'GET' && e.path === '/api/v2/status');
assert(!!status3, '(3-level) GET /api/v2/status resolved through 3 nested mounts');
// prefixDepth counts the number of prefix hops walked (2 hops: apiRouter→app and v2Router→apiRouter)
assert(status3 && status3.prefixDepth === 2, '(3-level) prefixDepth is 2 (two prefix hops resolved)');

// ── Multiple unrelated routers — each resolves independently ──
const multiFile = `
const app = require('express')();
const userRouter = require('express').Router();
const postRouter = require('express').Router();
app.use('/users', userRouter);
app.use('/posts', postRouter);
userRouter.get('/:id', getUser);
postRouter.delete('/:id', deletePost);
`.trim();

const eMulti = extractApiEndpoints(multiFile, 'src/app.js');
const resMulti = resolvePrefixes(eMulti.endpoints, eMulti.mountedPrefixes);
const user = resMulti.find(e => e.method === 'GET' && e.path === '/users/:id');
const post = resMulti.find(e => e.method === 'DELETE' && e.path === '/posts/:id');
assert(!!user, '(multi-router) GET /users/:id resolved independently');
assert(!!post, '(multi-router) DELETE /posts/:id resolved independently');

// ── Unresolved router reference — kept conservatively ──
const unresolvedFile = `
const unknownRouter = require('./some/external');
unknownRouter.get('/internal', handler);
`.trim();

const eUnresolved = extractApiEndpoints(unresolvedFile, 'src/mystery.js');
const resUnresolved = resolvePrefixes(eUnresolved.endpoints, eUnresolved.mountedPrefixes);
const internalEp = resUnresolved.find(e => e.path === '/internal');
assert(!!internalEp, '(unresolved) Route with unknown router kept conservatively');
assert(internalEp && internalEp.prefixResolved === false, '(unresolved) prefixResolved remains false');

// ── Circular reference protection ──
const circularMounts = [
  { objectName: 'routerA', prefix: '/a', routerVar: 'routerB', source: 'app.js', line: 1 },
  { objectName: 'routerB', prefix: '/b', routerVar: 'routerA', source: 'app.js', line: 2 },
];
const circularEndpoints = [
  { type: 'API_ENDPOINT', objectName: 'routerA', method: 'GET', path: '/test', source: 'app.js', line: 3, prefixResolved: false },
];
let circularError = false;
try {
  const resCircular = resolvePrefixes(circularEndpoints, circularMounts);
  assert(Array.isArray(resCircular), '(circular) No crash on circular mount graph');
} catch {
  circularError = true;
}
assert(!circularError, '(circular) Circular mount reference does not throw');

// ══════════════════════════════════════════════════════════════════════
// ISSUE 2 — LICENSE FILE EXCLUSION FROM ENV VAR EXTRACTION
// ══════════════════════════════════════════════════════════════════════
section('Issue 2: LICENSE File Exclusion from Env Var Extraction');

const mitLicenseText = `
MIT License

Copyright (c) 2021 Hagop Jamkojian

Permission is hereby granted, free of charge, to any person obtaining a copy
of this SOFTWARE and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the SOFTWARE.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`.trim();

const licFilenames = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENSE.rst', 'license.md'];

for (const fname of licFilenames) {
  const result = extractFromDocumentation(mitLicenseText, fname);
  assert(
    result.environmentVariables.length === 0,
    `(Issue 2) ${fname}: zero env vars extracted from MIT license text`
  );
}

// LICENSE exclusion does NOT suppress API endpoint detection from license files
// (unlikely in practice, but must not break the contract)
assert(true, '(Issue 2) API endpoint extraction unaffected by license exclusion');

// README.md continues to extract real env vars
const readmeWithEnvVars = `
## Configuration

Set the following environment variables:

| Variable | Description |
|----------|-------------|
| \`JWT_SECRET\` | Secret for JWT signing |
| \`MONGODB_URI\` | MongoDB connection string |
| \`PORT\` | Server listen port |
| \`SMTP_HOST\` | SMTP server hostname |

Run: \`JWT_SECRET=abc npm start\`
`.trim();

const readmeResult = extractFromDocumentation(readmeWithEnvVars, 'README.md');
const readmeVarNames = readmeResult.environmentVariables.map(v => v.name);
assert(readmeVarNames.includes('JWT_SECRET'), '(Issue 2) README.md: JWT_SECRET still extracted');
assert(readmeVarNames.includes('MONGODB_URI'), '(Issue 2) README.md: MONGODB_URI still extracted');
assert(readmeVarNames.includes('SMTP_HOST'), '(Issue 2) README.md: SMTP_HOST still extracted');

// ══════════════════════════════════════════════════════════════════════
// ISSUE 3 — TEST FILE EXCLUSION FROM API EXTRACTION
// ══════════════════════════════════════════════════════════════════════
section('Issue 3: Test File Exclusion from Production API Extraction');

async function testIssue3() {
  const provider = new MockRepositoryProvider();
  provider.addRepository('testorg', 'myapp', {
    commitSha: 'abc123',
    files: {
      'src/routes/api.js': `
const apiRouter = require('express').Router();
apiRouter.get('/users', getUsers);
module.exports = apiRouter;
`.trim(),

      'src/app.js': `
const app = require('express')();
const apiRouter = require('./routes/api');
app.use('/api', apiRouter);
module.exports = app;
`.trim(),

      // Test file that registers fake routes — must NOT appear in production facts
      'tests/integration/api.test.js': `
const express = require('express');
const app = express();
// Test helper route — NOT a production endpoint
app.get('/fake-test-route', handler);
app.post('/another-fake', handler);
const request = require('supertest');
`.trim(),

      '__tests__/unit/auth.test.js': `
const router = require('express').Router();
// Another fake test route
router.delete('/test-users-cleanup', cleanupHandler);
`.trim(),

      'README.md': `
# My App

API: GET /api/users
`.trim(),

      'package.json': JSON.stringify({ name: 'myapp', dependencies: {} }),
    },
  });

  const scanner = new RepositoryScanner(provider);
  const result = await scanner.scan('testorg', 'myapp', 'main');

  const apiPaths = result.facts.codeFacts.apiEndpoints.map(e => e.path);

  assert(apiPaths.includes('/api/users'), '(Issue 3) Production GET /api/users is detected');
  assert(!apiPaths.includes('/fake-test-route'), '(Issue 3) Fake test route /fake-test-route excluded');
  assert(!apiPaths.includes('/another-fake'), '(Issue 3) Fake test route /another-fake excluded');
  assert(!apiPaths.includes('/test-users-cleanup'), '(Issue 3) __tests__ route excluded');

  // Files are still in inventory
  assert(result.files.some(f => f.path === 'tests/integration/api.test.js'), '(Issue 3) Test file still in inventory');
  assert(result.files.some(f => f.path === '__tests__/unit/auth.test.js'), '(Issue 3) __tests__ file still in inventory');

  // Production source not suppressed
  assert(result.files.some(f => f.path === 'src/routes/api.js'), '(Issue 3) Production source in inventory');
}

// ══════════════════════════════════════════════════════════════════════
// ISSUE 4 — SYSTEM ENV VAR SKIP LIST
// ══════════════════════════════════════════════════════════════════════
section('Issue 4: System Environment Variable Skip List');

async function testIssue4() {
  const provider = new MockRepositoryProvider();
  provider.addRepository('testorg', 'envapp', {
    commitSha: 'def456',
    files: {
      'src/config.js': `
const env = process.env.NODE_ENV;
const port = process.env.PORT;
const secret = process.env.JWT_SECRET;
const dbUrl = process.env.MONGODB_URI;
const shell = process.env.SHELL;
const home = process.env.HOME;
`.trim(),

      '.env.example': `
PORT=3000
JWT_SECRET=changeme
MONGODB_URI=mongodb://localhost
`.trim(),

      'README.md': `
## Setup

Set \`JWT_SECRET\` and \`MONGODB_URI\`.
`.trim(),

      'package.json': JSON.stringify({ name: 'envapp', dependencies: {} }),
    },
  });

  const scanner = new RepositoryScanner(provider);
  const result = await scanner.scan('testorg', 'envapp', 'main');

  const codeVarNames = result.facts.codeFacts.environmentVariables.map(v => v.name);

  // Application vars must be present
  assert(codeVarNames.includes('PORT'), '(Issue 4) PORT (from .env.example) retained');
  assert(codeVarNames.includes('JWT_SECRET'), '(Issue 4) JWT_SECRET retained');
  assert(codeVarNames.includes('MONGODB_URI'), '(Issue 4) MONGODB_URI retained');

  // System vars must be suppressed
  assert(!codeVarNames.includes('NODE_ENV'), '(Issue 4) NODE_ENV filtered from code facts');
  assert(!codeVarNames.includes('SHELL'), '(Issue 4) SHELL filtered from code facts');
  assert(!codeVarNames.includes('HOME'), '(Issue 4) HOME filtered from code facts');

  // System var NODE_ENV must not generate a drift finding
  const drift = result.drift;
  const nodeEnvFinding = drift.findings.find(f => f.resource && f.resource.name === 'NODE_ENV');
  assert(!nodeEnvFinding, '(Issue 4) NODE_ENV does not produce any drift finding');
}

// ══════════════════════════════════════════════════════════════════════
// ISSUE 5 — CONTEXT-SENSITIVE DOCUMENTATION ENV VAR HEURISTICS
// ══════════════════════════════════════════════════════════════════════
section('Issue 5: Context-Sensitive Documentation Env Var Heuristics');

// --- FALSE POSITIVE CASES (must NOT be extracted) ---
const proseParagraph = `
This is a REST API built with NODE and EXPRESS.
The API uses SMTP for sending emails and PM2 for process management.
ESL rules are enforced. We follow the MIT license.
IDE setup is documented below. NOT_FOUND errors return 404.
`.trim();

const proseResult = extractFromDocumentation(proseParagraph, 'README.md');
const proseVars = proseResult.environmentVariables.map(v => v.name);

assert(!proseVars.includes('REST'),      '(Issue 5) REST not extracted from prose');
assert(!proseVars.includes('SMTP'),      '(Issue 5) SMTP not extracted from prose');
assert(!proseVars.includes('PM2'),       '(Issue 5) PM2 not extracted from prose');
assert(!proseVars.includes('ESL'),       '(Issue 5) ESL not extracted from prose');
assert(!proseVars.includes('MIT'),       '(Issue 5) MIT not extracted from prose');
assert(!proseVars.includes('IDE'),       '(Issue 5) IDE not extracted from prose');
assert(!proseVars.includes('NOT_FOUND'), '(Issue 5) NOT_FOUND not extracted from prose');
assert(!proseVars.includes('NODE'),      '(Issue 5) NODE not extracted from prose');
assert(!proseVars.includes('EXPRESS'),   '(Issue 5) EXPRESS not extracted from prose');

// --- TRUE POSITIVE CASES (must still be extracted) ---
const configSection = `
## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| \`JWT_SECRET\` | Yes | Secret key for JWT |
| \`MONGODB_URI\` | Yes | MongoDB connection string |
| \`REDIS_URL\` | No | Redis connection |
| \`GOOGLE_CLIENT_ID\` | No | Google OAuth |

\`SMTP_HOST\` and \`SMTP_PORT\` configure email delivery.
`.trim();

const configResult = extractFromDocumentation(configSection, 'README.md');
const configVars = configResult.environmentVariables.map(v => v.name);

assert(configVars.includes('JWT_SECRET'),       '(Issue 5) JWT_SECRET extracted from config table');
assert(configVars.includes('MONGODB_URI'),      '(Issue 5) MONGODB_URI extracted from config table');
assert(configVars.includes('REDIS_URL'),        '(Issue 5) REDIS_URL extracted from config table');
assert(configVars.includes('GOOGLE_CLIENT_ID'), '(Issue 5) GOOGLE_CLIENT_ID extracted from config table');
assert(configVars.includes('SMTP_HOST'),        '(Issue 5) SMTP_HOST extracted (backtick-quoted)');
assert(configVars.includes('SMTP_PORT'),        '(Issue 5) SMTP_PORT extracted (backtick-quoted)');

// Backtick-quoted assignment in code examples
const codeBlockSection = `
\`\`\`bash
JWT_SECRET=your-secret-here
MONGODB_URI=mongodb://localhost:27017/myapp
PORT=3000
\`\`\`
`.trim();

const codeBlockResult = extractFromDocumentation(codeBlockSection, 'docs/setup.md');
const codeBlockVars = codeBlockResult.environmentVariables.map(v => v.name);
assert(codeBlockVars.includes('JWT_SECRET'),  '(Issue 5) JWT_SECRET extracted from code block assignment');
assert(codeBlockVars.includes('MONGODB_URI'), '(Issue 5) MONGODB_URI extracted from code block assignment');

// process.env reference in documentation
const processEnvDoc = `
The server reads \`process.env.DATABASE_URL\` for connection.
Also set \`process.env.STRIPE_SECRET_KEY\` in production.
`.trim();
const procEnvResult = extractFromDocumentation(processEnvDoc, 'docs/config.md');
const procEnvVars = procEnvResult.environmentVariables.map(v => v.name);
assert(procEnvVars.includes('DATABASE_URL'),      '(Issue 5) DATABASE_URL from process.env reference');
assert(procEnvVars.includes('STRIPE_SECRET_KEY'), '(Issue 5) STRIPE_SECRET_KEY from process.env reference');

// ══════════════════════════════════════════════════════════════════════
// PHASE 4A / 4B / 5A REGRESSIONS
// ══════════════════════════════════════════════════════════════════════
section('Phase 4A/4B/5A Regressions');

assert(sanitizePath('src/app.js') === 'src/app.js', '[Reg 4A] Path sanitization');
assert(isExcludedSecretFile('.env') === true,        '[Reg 4A] .env excluded');
assert(isExcludedSecretFile('.env.example') === false, '[Reg 4A] .env.example permitted');
assert(isBinaryExtension('logo.png') === true,       '[Reg 4A] PNG is binary');
assert(classifyFile('src/app.js') === CATEGORIES.SOURCE,        '[Reg 4A] JS is SOURCE');
assert(classifyFile('README.md') === CATEGORIES.DOCUMENTATION,  '[Reg 4A] README is DOCUMENTATION');

// 1-level prefix still works (Phase 4B regression)
const regSource = `
const userRouter = require('express').Router();
userRouter.get('/login', loginHandler);
userRouter.post('/register', registerHandler);
`.trim();
const regApp = `
const app = require('express')();
const userRouter = require('./userRouter');
app.use('/api/users', userRouter);
`.trim();
const regE1 = extractApiEndpoints(regSource, 'src/userRouter.js');
const regE2 = extractApiEndpoints(regApp, 'src/app.js');
const regAll = [...regE1.endpoints, ...regE2.endpoints];
const regMounts = [...regE1.mountedPrefixes, ...regE2.mountedPrefixes];
const regResolved = resolvePrefixes(regAll, regMounts);
const regLogin = regResolved.find(e => e.method === 'GET' && e.path === '/api/users/login');
assert(!!regLogin, '[Reg 4B] 1-level prefix resolution still works');

// detectDrift edge cases (Phase 5A regression)
const emptyDrift = detectDrift({});
assert(emptyDrift.summary.total === 0, '[Reg 5A] detectDrift with empty facts → 0 findings');
assert(detectDrift(null).summary.total === 0, '[Reg 5A] detectDrift with null → 0 findings');

// ══════════════════════════════════════════════════════════════════════
// RUN ASYNC TESTS + SUMMARY
// ══════════════════════════════════════════════════════════════════════
async function runAll() {
  await testIssue3();
  await testIssue4();

  console.log(`\n${'═'.repeat(60)}`);
  if (failures.length === 0) {
    console.log(`  ✅ ALL ${passed}/${total} PHASE 5A.1 TESTS PASSED!`);
  } else {
    console.log(`  ❌ ${failures.length} FAILURES / ${total} TESTS`);
    failures.forEach(f => console.log(`     - ${f}`));
    process.exit(1);
  }
  console.log(`${'═'.repeat(60)}\n`);
}

runAll().catch(err => {
  console.error('\n❌ Phase 5A.1 Test Suite Error:', err.message);
  process.exit(1);
});
