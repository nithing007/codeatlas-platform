/**
 * Phase 5A.2 — Final Precision Test Suite
 *
 * Covers:
 *   1. Cross-file router prefix resolution:
 *      - app.js → routes/index.js → auth.route.js
 *      - two-level mount prefix
 *      - three-level mount prefix
 *      - CommonJS require
 *      - ES module import
 *      - default / index.js resolution
 *      - explicit .js resolution
 *      - sibling router files
 *      - route table object arrays (e.g. [{ path: '/auth', route: authRoute }])
 *      - router.route('/path').get(...).post(...) method chaining
 *      - duplicate mount protection
 *      - unresolved dynamic imports
 *      - circular module references
 *      - original evidence preservation
 *      - no duplicate endpoint facts
 *   2. OPTIONS filtering:
 *      - wildcard OPTIONS excluded: app.options('*', cors()), app.options('/*', cors())
 *      - explicit OPTIONS endpoint retained: app.options('/api/upload', ...)
 *   3. Markdown table / config env vars:
 *      - PORT recognized inside configuration table
 *      - JWT_SECRET recognized
 *      - PORT recognized in code block under ## Environment Variables
 *      - arbitrary prose REST/SMTP/IDE not recognized
 *      - LICENSE exclusion remains intact
 *   4. Full regression of Phase 4A, 4B, 5A, 5A.1.
 */

'use strict';

const {
  extractApiEndpoints,
  resolvePrefixes,
  extractFromDocumentation,
  extractModuleGraph,
  resolveWithModuleGraph,
  resolveModulePath,
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
const failures = [];

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
// 1. MODULE GRAPH & PATH RESOLUTION
// ══════════════════════════════════════════════════════════════════════
section('Module Graph Extractor & Path Resolution');

{
  const cjsContent = `
    const express = require('express');
    const authRoute = require('./auth.route');
    const userRoute = require('./user.route.js');
    const subRoute = require('./sub/index');
    const router = express.Router();
    module.exports = router;
  `;
  const { requires, exportedVar } = extractModuleGraph(cjsContent, 'src/routes/v1/index.js');
  assert(exportedVar === 'router', 'CommonJS exportedVar is router');
  assert(requires.get('authRoute') === './auth.route', 'require authRoute relative path extracted');
  assert(requires.get('userRoute') === './user.route.js', 'require userRoute with .js extracted');
  assert(!requires.has('express'), 'external package express is ignored');

  const fileSet = new Set([
    'src/routes/v1/index.js',
    'src/routes/v1/auth.route.js',
    'src/routes/v1/user.route.js',
    'src/routes/v1/sub/index.js',
  ]);

  const p1 = resolveModulePath('src/routes/v1/index.js', './auth.route', fileSet);
  assert(p1 === 'src/routes/v1/auth.route.js', 'resolveModulePath appends .js correctly');

  const p2 = resolveModulePath('src/routes/v1/index.js', './user.route.js', fileSet);
  assert(p2 === 'src/routes/v1/user.route.js', 'resolveModulePath handles explicit .js');

  const p3 = resolveModulePath('src/routes/v1/index.js', './sub/index', fileSet);
  assert(p3 === 'src/routes/v1/sub/index.js', 'resolveModulePath handles sub/index');

  const p4 = resolveModulePath('src/app.js', './routes/v1', fileSet);
  assert(p4 === 'src/routes/v1/index.js', 'resolveModulePath handles folder /index.js resolution');

  const pNone = resolveModulePath('src/app.js', './nonexistent', fileSet);
  assert(pNone === null, 'resolveModulePath returns null for missing target');

  // Dynamic or non-relative import
  const pNonRelative = resolveModulePath('src/app.js', 'express', fileSet);
  assert(pNonRelative === null, 'resolveModulePath returns null for bare packages');
}

// ── ES Module import/export support ──
{
  const esmContent = `
    import authRoute from './auth.route';
    import userRoute from './user.route';
    const router = express.Router();
    export default router;
  `;
  const { requires, exportedVar } = extractModuleGraph(esmContent, 'src/routes/index.js');
  assert(exportedVar === 'router', 'ES module default export variable extracted');
  assert(requires.get('authRoute') === './auth.route', 'ES module import path extracted');
  assert(requires.get('userRoute') === './user.route', 'ES module second import path extracted');
}

// ══════════════════════════════════════════════════════════════════════
// 2. CROSS-FILE ROUTER PREFIX RESOLUTION
// ══════════════════════════════════════════════════════════════════════
section('Cross-File Router Prefix Resolution');

// ── Two-level: app.js -> routes/v1/index.js -> auth.route.js ──
{
  const appCode = `
    const express = require('express');
    const routes = require('./routes/v1');
    const app = express();
    app.use('/v1', routes);
    module.exports = app;
  `;
  const indexCode = `
    const express = require('express');
    const authRoute = require('./auth.route');
    const userRoute = require('./user.route');
    const router = express.Router();
    router.use('/auth', authRoute);
    router.use('/users', userRoute);
    module.exports = router;
  `;
  const authCode = `
    const express = require('express');
    const router = express.Router();
    router.post('/register', register);
    router.post('/login', login);
    module.exports = router;
  `;
  const userCode = `
    const express = require('express');
    const router = express.Router();
    router.get('/', listUsers);
    router.get('/:userId', getUser);
    module.exports = router;
  `;

  const files = {
    'src/app.js': appCode,
    'src/routes/v1/index.js': indexCode,
    'src/routes/v1/auth.route.js': authCode,
    'src/routes/v1/user.route.js': userCode,
  };

  const fileRequiresMap = new Map();
  const fileExportsMap = new Map();
  const allMounts = [];
  let allEndpoints = [];
  const filePathSet = new Set(Object.keys(files));

  for (const [fp, content] of Object.entries(files)) {
    const { requires, exportedVar } = extractModuleGraph(content, fp);
    fileRequiresMap.set(fp, requires);
    if (exportedVar) fileExportsMap.set(fp, exportedVar);

    const { endpoints, mountedPrefixes } = extractApiEndpoints(content, fp);
    allEndpoints = allEndpoints.concat(endpoints);
    allMounts.push(...mountedPrefixes);
  }

  const resolved = resolveWithModuleGraph(
    allEndpoints,
    allMounts,
    fileRequiresMap,
    fileExportsMap,
    filePathSet
  );

  const authRegister = resolved.find(e => e.method === 'POST' && e.path === '/v1/auth/register');
  assert(!!authRegister, 'POST /v1/auth/register resolved through 2 cross-file hops');
  assert(authRegister && authRegister.prefixResolved === true, 'prefixResolved is true');
  assert(authRegister && authRegister.prefixDepth === 2, 'prefixDepth is 2');
  assert(authRegister && authRegister.source === 'src/routes/v1/auth.route.js', 'original source preserved');
  assert(authRegister && typeof authRegister.line === 'number', 'original line number preserved');

  const authLogin = resolved.find(e => e.method === 'POST' && e.path === '/v1/auth/login');
  assert(!!authLogin, 'POST /v1/auth/login resolved');

  const usersList = resolved.find(e => e.method === 'GET' && e.path === '/v1/users');
  assert(!!usersList, 'GET /v1/users resolved (trailing slash normalized)');

  const userDetail = resolved.find(e => e.method === 'GET' && e.path === '/v1/users/:userId');
  assert(!!userDetail, 'GET /v1/users/:userId resolved');

  // No duplicate endpoints
  const registerCount = resolved.filter(e => e.method === 'POST' && e.path === '/v1/auth/register').length;
  assert(registerCount === 1, 'no duplicate endpoint facts created');
}

// ── Three-level nested mount chain ──
{
  const rootCode = `
    const api = require('./api');
    app.use('/api', api);
    module.exports = app;
  `;
  const apiCode = `
    const v2 = require('./v2');
    router.use('/v2', v2);
    module.exports = router;
  `;
  const v2Code = `
    const billing = require('./billing');
    router.use('/billing', billing);
    module.exports = router;
  `;
  const billingCode = `
    router.post('/charge', doCharge);
    module.exports = router;
  `;

  const files = {
    'src/server.js': rootCode,
    'src/api/index.js': apiCode,
    'src/api/v2/index.js': v2Code,
    'src/api/v2/billing.js': billingCode,
  };

  const fileRequiresMap = new Map();
  const fileExportsMap = new Map();
  const allMounts = [];
  let allEndpoints = [];
  const filePathSet = new Set(Object.keys(files));

  for (const [fp, content] of Object.entries(files)) {
    const { requires, exportedVar } = extractModuleGraph(content, fp);
    fileRequiresMap.set(fp, requires);
    if (exportedVar) fileExportsMap.set(fp, exportedVar);

    const { endpoints, mountedPrefixes } = extractApiEndpoints(content, fp);
    allEndpoints = allEndpoints.concat(endpoints);
    allMounts.push(...mountedPrefixes);
  }

  const resolved = resolveWithModuleGraph(
    allEndpoints,
    allMounts,
    fileRequiresMap,
    fileExportsMap,
    filePathSet
  );

  const charge = resolved.find(e => e.path === '/api/v2/billing/charge');
  assert(!!charge, '3-level cross-file mount: POST /api/v2/billing/charge resolved');
  assert(charge && charge.prefixDepth === 3, 'prefixDepth is 3 for three levels');
}

// ── Route table array pattern + method chaining (node-express-boilerplate structure) ──
{
  const indexWithTable = `
    const express = require('express');
    const authRoute = require('./auth.route');
    const userRoute = require('./user.route');
    const router = express.Router();

    const defaultRoutes = [
      {
        path: '/auth',
        route: authRoute,
      },
      {
        path: '/users',
        route: userRoute,
      },
    ];

    defaultRoutes.forEach((route) => {
      router.use(route.path, route.route);
    });

    module.exports = router;
  `;

  const appWithTable = `
    const express = require('express');
    const routes = require('./routes/v1');
    const app = express();
    app.use('/v1', routes);
    module.exports = app;
  `;

  const userChainedRoutes = `
    const express = require('express');
    const router = express.Router();

    router
      .route('/')
      .post(createUser)
      .get(getUsers);

    router
      .route('/:userId')
      .get(getUser)
      .patch(updateUser)
      .delete(deleteUser);

    module.exports = router;
  `;

  const files = {
    'src/app.js': appWithTable,
    'src/routes/v1/index.js': indexWithTable,
    'src/routes/v1/user.route.js': userChainedRoutes,
  };

  const fileRequiresMap = new Map();
  const fileExportsMap = new Map();
  const allMounts = [];
  let allEndpoints = [];
  const filePathSet = new Set(Object.keys(files));

  for (const [fp, content] of Object.entries(files)) {
    const { requires, exportedVar } = extractModuleGraph(content, fp);
    fileRequiresMap.set(fp, requires);
    if (exportedVar) fileExportsMap.set(fp, exportedVar);

    const { endpoints, mountedPrefixes } = extractApiEndpoints(content, fp);
    allEndpoints = allEndpoints.concat(endpoints);
    allMounts.push(...mountedPrefixes);
  }

  const resolved = resolveWithModuleGraph(
    allEndpoints,
    allMounts,
    fileRequiresMap,
    fileExportsMap,
    filePathSet
  );

  assert(!!resolved.find(e => e.method === 'POST' && e.path === '/v1/users'), 'Chained route: POST /v1/users resolved from table + chaining');
  assert(!!resolved.find(e => e.method === 'GET' && e.path === '/v1/users'), 'Chained route: GET /v1/users resolved');
  assert(!!resolved.find(e => e.method === 'GET' && e.path === '/v1/users/:userId'), 'Chained route: GET /v1/users/:userId resolved');
  assert(!!resolved.find(e => e.method === 'PATCH' && e.path === '/v1/users/:userId'), 'Chained route: PATCH /v1/users/:userId resolved');
  assert(!!resolved.find(e => e.method === 'DELETE' && e.path === '/v1/users/:userId'), 'Chained route: DELETE /v1/users/:userId resolved');
}

// ── Circular module reference protection ──
{
  const circA = `
    const b = require('./b');
    router.use('/a', b);
    module.exports = router;
  `;
  const circB = `
    const a = require('./a');
    router.use('/b', a);
    router.get('/endpoint', handler);
    module.exports = router;
  `;

  const files = {
    'src/a.js': circA,
    'src/b.js': circB,
  };

  const fileRequiresMap = new Map();
  const fileExportsMap = new Map();
  const allMounts = [];
  let allEndpoints = [];
  const filePathSet = new Set(Object.keys(files));

  for (const [fp, content] of Object.entries(files)) {
    const { requires, exportedVar } = extractModuleGraph(content, fp);
    fileRequiresMap.set(fp, requires);
    if (exportedVar) fileExportsMap.set(fp, exportedVar);

    const { endpoints, mountedPrefixes } = extractApiEndpoints(content, fp);
    allEndpoints = allEndpoints.concat(endpoints);
    allMounts.push(...mountedPrefixes);
  }

  // Must not throw or hang in infinite loop
  let didHang = false;
  let resolvedCirc;
  try {
    resolvedCirc = resolveWithModuleGraph(
      allEndpoints,
      allMounts,
      fileRequiresMap,
      fileExportsMap,
      filePathSet
    );
  } catch (err) {
    didHang = true;
  }
  assert(!didHang, 'circular require chain does not crash or hang');
  assert(resolvedCirc.length > 0, 'endpoints preserved even with circular chain');
}

// ── Unresolved / dynamic require fallback ──
{
  const standaloneContent = `
    const router = express.Router();
    router.get('/standalone', handler);
    module.exports = router;
  `;
  const { endpoints } = extractApiEndpoints(standaloneContent, 'src/orphan.js');
  const res = resolveWithModuleGraph(
    endpoints,
    [],
    new Map(),
    new Map(),
    new Set(['src/orphan.js'])
  );
  assert(res[0].path === '/standalone', 'unresolved endpoint conservatively retained');
  assert(res[0].prefixResolved === false, 'prefixResolved remains false for unmounted route');
}

// ══════════════════════════════════════════════════════════════════════
// 3. OPTIONS FILTERING
// ══════════════════════════════════════════════════════════════════════
section('OPTIONS Infrastructure Route Filtering');

{
  const optSrc = `
    app.options('*', cors());
    app.options('/*', cors());
    app.options('/api/upload', uploadPreflightHandler);
    app.get('/api/users', getUsers);
  `;
  const { endpoints } = extractApiEndpoints(optSrc, 'src/server.js');

  const wildcardStar = endpoints.find(e => e.method === 'OPTIONS' && (e.path === '/*' || e.path === '*'));
  assert(!wildcardStar, 'OPTIONS * / /* wildcard infrastructure route excluded');

  const explicitOpt = endpoints.find(e => e.method === 'OPTIONS' && e.path === '/api/upload');
  assert(!!explicitOpt, 'explicit OPTIONS /api/upload endpoint is retained');

  const getEp = endpoints.find(e => e.method === 'GET' && e.path === '/api/users');
  assert(!!getEp, 'normal GET route unaffected by OPTIONS filter');
}

// ══════════════════════════════════════════════════════════════════════
// 4. MARKDOWN TABLE & CONFIG ENV VARS
// ══════════════════════════════════════════════════════════════════════
section('Markdown Configuration Table & Context Env Vars');

{
  // Markdown configuration table
  const tableDoc = `
# Project Setup

## Configuration

| Environment Variable | Description |
| PORT | Application server port |
| JWT_SECRET | JWT signing secret |
| MONGODB_URI | MongoDB connection string |

Some prose explaining that this uses REST and SMTP services. Tested with PM2, ESL, and IDE.
  `;
  const resTable = extractFromDocumentation(tableDoc, 'README.md');
  const namesTable = resTable.environmentVariables.map(v => v.name);

  assert(namesTable.includes('PORT'), 'PORT recognized inside configuration table');
  assert(namesTable.includes('JWT_SECRET'), 'JWT_SECRET recognized inside configuration table');
  assert(namesTable.includes('MONGODB_URI'), 'MONGODB_URI recognized inside configuration table');

  // Negative tests: prose words
  assert(!namesTable.includes('REST'), 'REST in prose rejected');
  assert(!namesTable.includes('SMTP'), 'SMTP in prose rejected');
  assert(!namesTable.includes('PM2'), 'PM2 in prose rejected');
  assert(!namesTable.includes('ESL'), 'ESL in prose rejected');
  assert(!namesTable.includes('IDE'), 'IDE in prose rejected');

  // Code block under ## Environment Variables (real node-express-boilerplate format)
  const codeBlockDoc = `
## Environment Variables

The environment variables can be found and modified in the \`.env\` file. They come with these default values:

\`\`\`bash
# Port number
PORT=3000

# URL of the Mongo DB
MONGODB_URL=mongodb://127.0.0.1:27017/node-boilerplate

# JWT secret key
JWT_SECRET=thisisasamplesecret
\`\`\`
  `;
  const resCode = extractFromDocumentation(codeBlockDoc, 'README.md');
  const namesCode = resCode.environmentVariables.map(v => v.name);

  assert(namesCode.includes('PORT'), 'PORT=3000 recognized under ## Environment Variables bash block');
  assert(namesCode.includes('MONGODB_URL'), 'MONGODB_URL recognized in bash block');
  assert(namesCode.includes('JWT_SECRET'), 'JWT_SECRET recognized in bash block');

  // LICENSE file exclusion remains intact
  const licenseDoc = `
MIT License
PORT JWT_SECRET MONGODB_URI
  `;
  const resLic = extractFromDocumentation(licenseDoc, 'LICENSE.md');
  assert(resLic.environmentVariables.length === 0, 'LICENSE.md still extracts zero env vars');
}

// ══════════════════════════════════════════════════════════════════════
// 5. FULL SCAN PIPELINE INTEGRATION TEST
// ══════════════════════════════════════════════════════════════════════
section('Full Pipeline Integration Scan with Cross-File Routing & Drift');

(async () => {
  const mockRepo = {
    'package.json': JSON.stringify({
      name: 'express-app',
      dependencies: { express: '^4.18.0' },
      scripts: { start: 'node src/index.js' },
    }),
    'src/app.js': `
      const express = require('express');
      const routes = require('./routes');
      const app = express();
      app.options('*', cors());
      app.use('/api', routes);
      module.exports = app;
    `,
    'src/routes/index.js': `
      const express = require('express');
      const authRoute = require('./auth');
      const router = express.Router();
      router.use('/auth', authRoute);
      module.exports = router;
    `,
    'src/routes/auth.js': `
      const express = require('express');
      const router = express.Router();
      router.post('/login', login);
      router.post('/register', register);
      module.exports = router;
    `,
    '.env.example': `
      PORT=3000
      JWT_SECRET=secret
    `,
    'README.md': `
# Sample App

## Environment Variables

\`\`\`bash
PORT=3000
JWT_SECRET=secret
\`\`\`

## API Endpoints

POST /api/auth/login
POST /api/auth/register
    `,
  };

  const provider = new MockRepositoryProvider({
    'testorg/crossfile-test': {
      commitSha: 'mocksha1234567890',
      files: mockRepo,
    },
  });
  const scanner = new RepositoryScanner(provider);
  const scanResult = await scanner.scan('testorg', 'crossfile-test', 'main');

  const { codeFacts, documentationFacts } = scanResult.facts;
  const { drift } = scanResult;

  // 1. Cross-file resolution verified in code facts
  const hasLogin = codeFacts.apiEndpoints.some(e => e.method === 'POST' && e.path === '/api/auth/login');
  assert(hasLogin, 'Pipeline: POST /api/auth/login resolved in scan codeFacts');

  const hasRegister = codeFacts.apiEndpoints.some(e => e.method === 'POST' && e.path === '/api/auth/register');
  assert(hasRegister, 'Pipeline: POST /api/auth/register resolved in scan codeFacts');

  // 2. Wildcard options excluded from code facts
  const hasWildcardOpt = codeFacts.apiEndpoints.some(e => e.method === 'OPTIONS' && e.path === '/*');
  assert(!hasWildcardOpt, 'Pipeline: OPTIONS /* excluded from scan codeFacts');

  // 3. Env var PORT documented
  const hasDocPort = documentationFacts.environmentVariables.some(v => v.name === 'PORT');
  assert(hasDocPort, 'Pipeline: PORT recognized in doc facts');

  // 4. Zero drift because code routes and docs match perfectly
  assert(drift.summary.total === 0, `Pipeline: Zero drift findings when cross-file matches docs (got ${drift.summary.total})`);

  // ══════════════════════════════════════════════════════════════════════
  // 6. REGRESSION VERIFICATION (Phases 4A, 4B, 5A, 5A.1)
  // ══════════════════════════════════════════════════════════════════════
  section('Regression Verification (Phase 4A/4B/5A/5A.1)');

  assert(sanitizePath('src\\file.js') === 'src/file.js', '[Reg 4A] sanitizePath works');
  assert(isExcludedSecretFile('.env'), '[Reg 4A] .env is excluded secret');
  assert(isBinaryExtension('image.png'), '[Reg 4A] PNG is binary');
  assert(classifyFile('server.js') === CATEGORIES.SOURCE, '[Reg 4A] server.js is SOURCE');
  assert(classifyFile('README.md') === CATEGORIES.DOCUMENTATION, '[Reg 4A] README.md is DOCUMENTATION');

  const driftEmpty = detectDrift({ codeFacts: {}, documentationFacts: {} });
  assert(driftEmpty.summary.total === 0, '[Reg 5A] detectDrift handles empty facts');

  // ══════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ══════════════════════════════════════════════════════════════════════
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  Phase 5A.2 Test Suite Results`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Total:  ${total}`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failures.length}`);

  if (failures.length > 0) {
    console.error('\n❌ Failures:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  } else {
    console.log(`\n🎉 ALL ${passed}/${total} PHASE 5A.2 TESTS PASSED!\n`);
  }
})();
