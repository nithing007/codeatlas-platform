/**
 * Phase 4B — Code & Documentation Fact Extraction Test Suite
 * Tests extractors individually and as a full integrated scan.
 */

const {
  RepositoryScanner,
  MockRepositoryProvider,
  extractApiEndpoints,
  resolvePrefixes,
  extractEnvVarsFromSource,
  extractEnvVarsFromTemplate,
  extractFromPackageJson,
  extractFromDocumentation,
  extractFromOpenApi,
  normalizeMethod,
  normalizePath,
  // Phase 4A imports (regression)
  sanitizePath,
  isExcludedSecretFile,
  isBinaryExtension,
  classifyFile,
  CATEGORIES,
} = require('../src/index');

let passed = 0;
let total = 0;

function assert(condition, message) {
  total++;
  if (!condition) {
    console.error(`  ❌ FAILED: ${message}`);
    throw new Error(`Test assertion failed: ${message}`);
  }
  passed++;
  console.log(`  ✅ ${message}`);
}

function section(title) {
  console.log(`\n--- ${title} ---`);
}

// ======================================================================
// SECTION 1: Normalization
// ======================================================================
section('Normalization');

assert(normalizeMethod('get') === 'GET', 'HTTP method normalization: get → GET');
assert(normalizeMethod('Post') === 'POST', 'HTTP method normalization: Post → POST');
assert(normalizeMethod('DELETE') === 'DELETE', 'HTTP method normalization: DELETE stays DELETE');

assert(normalizePath('/api/users/') === '/api/users', 'Trailing slash stripped: /api/users/');
assert(normalizePath('api/users') === '/api/users', 'Leading slash added when missing');
assert(normalizePath('/api//users') === '/api/users', 'Double slash normalized');
assert(normalizePath('/') === '/', 'Root path preserved');
assert(normalizePath('/api/users/:id') === '/api/users/:id', 'Express :id params preserved');

// ======================================================================
// SECTION 2: Express API Extractor
// ======================================================================
section('Express API Extractor — Route Patterns');

const expressSource = `
const express = require('express');
const app = express();
const router = express.Router();

app.get('/api/health', healthHandler);
app.post('/api/auth/login', loginHandler);
app.put('/api/users/:id', updateUser);
app.patch('/api/users/:id', patchUser);
app.delete('/api/users/:id', deleteUser);
router.get('/users', listUsers);
router.post('/users', createUser);
router.get("/users/:id", getUser);
`.trim();

const { endpoints: expressEndpoints, mountedPrefixes } = extractApiEndpoints(expressSource, 'src/routes/api.js');

assert(expressEndpoints.length === 8, 'Extracted 8 route handler registrations');
const getHealth = expressEndpoints.find(e => e.method === 'GET' && e.path === '/api/health');
assert(!!getHealth, 'app.get /api/health extracted');
assert(getHealth.source === 'src/routes/api.js', 'Source file attributed to route');
assert(typeof getHealth.line === 'number' && getHealth.line > 0, 'Line number extracted for route');

const postLogin = expressEndpoints.find(e => e.method === 'POST' && e.path === '/api/auth/login');
assert(!!postLogin, 'app.post /api/auth/login extracted');

const putUser = expressEndpoints.find(e => e.method === 'PUT');
assert(!!putUser, 'app.put extracted');

const patchUser = expressEndpoints.find(e => e.method === 'PATCH');
assert(!!patchUser, 'app.patch extracted');

const deleteUser = expressEndpoints.find(e => e.method === 'DELETE');
assert(!!deleteUser, 'app.delete extracted');

const routerGet = expressEndpoints.find(e => e.objectName !== 'app' && e.method === 'GET' && e.path === '/users');
assert(!!routerGet, 'router.get /users extracted');

const routerPost = expressEndpoints.find(e => e.objectName !== 'app' && e.method === 'POST' && e.path === '/users');
assert(!!routerPost, 'router.post /users extracted');

// ======================================================================
// SECTION 3: Router Prefix Resolution
// ======================================================================
section('Express API Extractor — Router Prefix Resolution');

const appSource = `
const userRouter = require('./userRouter');
app.use('/api/users', userRouter);
`.trim();

const routerSource = `
const userRouter = require('express').Router();
userRouter.get('/login', loginHandler);
userRouter.post('/register', registerHandler);
`.trim();

const { endpoints: appEndpoints, mountedPrefixes: appMounts } = extractApiEndpoints(appSource, 'src/app.js');
const { endpoints: routerEndpoints, mountedPrefixes: routerMounts } = extractApiEndpoints(routerSource, 'src/userRouter.js');

const allEndpoints = [...appEndpoints, ...routerEndpoints];
const allMounts = [...appMounts, ...routerMounts];

const resolved = resolvePrefixes(allEndpoints, allMounts);

const resolvedLogin = resolved.find(e => e.method === 'GET' && e.path === '/api/users/login');
assert(!!resolvedLogin, 'Router prefix resolved: GET /api/users/login');
assert(resolvedLogin.prefixResolved === true, 'Resolved endpoint is flagged with prefixResolved:true');

const resolvedRegister = resolved.find(e => e.method === 'POST' && e.path === '/api/users/register');
assert(!!resolvedRegister, 'Router prefix resolved: POST /api/users/register');

// ======================================================================
// SECTION 4: Environment Variable Extractor
// ======================================================================
section('Environment Variable Extractor — Source');

const envSourceCode = `
const port = process.env.PORT || 3000;
const dbUri = process.env.MONGODB_URI;
const secret = process.env.JWT_SECRET;
const googleId = process.env['GOOGLE_CLIENT_ID'];
// duplicate reference should not create a second fact:
const port2 = process.env.PORT;
`.trim();

const envFacts = extractEnvVarsFromSource(envSourceCode, 'src/config/index.js');
assert(envFacts.length === 4, 'Extracted 4 unique env vars from source (PORT, MONGODB_URI, JWT_SECRET, GOOGLE_CLIENT_ID)');

const portFact = envFacts.find(f => f.name === 'PORT');
assert(!!portFact, 'process.env.PORT extracted');
assert(portFact.source === 'src/config/index.js', 'Source attributed to env var');
assert(typeof portFact.line === 'number' && portFact.line > 0, 'Line number extracted for env var');

const dbFact = envFacts.find(f => f.name === 'MONGODB_URI');
assert(!!dbFact, 'process.env.MONGODB_URI extracted');

const bracketFact = envFacts.find(f => f.name === 'GOOGLE_CLIENT_ID');
assert(!!bracketFact, 'process.env[\'GOOGLE_CLIENT_ID\'] bracket syntax extracted');

section('Environment Variable Extractor — .env Template');

const envTemplateContent = `
PORT=5000
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/codeatlas
JWT_SECRET=your_jwt_secret_here
# GOOGLE_CLIENT_ID=
`.trim();

const templateFacts = extractEnvVarsFromTemplate(envTemplateContent, '.env.example');
assert(templateFacts.length === 5, 'Extracted 5 vars from .env.example (PORT, NODE_ENV, MONGODB_URI, JWT_SECRET, GOOGLE_CLIENT_ID)');
assert(templateFacts.every(f => f.fromTemplate === true), 'All template facts flagged with fromTemplate:true');

const commentedFact = templateFacts.find(f => f.name === 'GOOGLE_CLIENT_ID');
assert(!!commentedFact && commentedFact.commented === true, 'Commented env var detected');

section('Environment Variable Extractor — .env Secret Exclusion');

// Simulating what the scanner does: actual .env files are excluded entirely, never passed to extractor
const isActualEnvExcluded = isExcludedSecretFile('.env');
assert(isActualEnvExcluded === true, 'Actual .env is correctly marked as excluded secret (never reaches extractor)');

// ======================================================================
// SECTION 5: Dependency Extractor
// ======================================================================
section('Dependency Extractor — package.json');

const packageJsonContent = JSON.stringify({
  name: 'codeatlas-backend',
  version: '1.0.0',
  scripts: {
    dev: 'nodemon server.js',
    test: 'node scratch/test.js',
    start: 'node server.js',
  },
  dependencies: {
    express: '^5.2.1',
    mongoose: '^8.0.0',
    bcryptjs: '^2.4.3',
  },
  devDependencies: {
    nodemon: '^3.1.14',
  },
}, null, 2);

const { dependencies, scripts, warnings: pkgWarnings } = extractFromPackageJson(packageJsonContent, 'backend/package.json');

assert(dependencies.length === 4, 'Extracted 4 dependencies (3 runtime + 1 dev)');
assert(scripts.length === 3, 'Extracted 3 scripts');
assert(pkgWarnings.length === 0, 'No warnings for valid package.json');

const expressDep = dependencies.find(d => d.name === 'express');
assert(!!expressDep, 'express dependency extracted');
assert(expressDep.version === '^5.2.1', 'express version correct');
assert(expressDep.section === 'dependencies', 'express in dependencies section');

const nodemonDep = dependencies.find(d => d.name === 'nodemon');
assert(!!nodemonDep && nodemonDep.section === 'devDependencies', 'nodemon in devDependencies section');

const devScript = scripts.find(s => s.name === 'dev');
assert(!!devScript && devScript.command === 'nodemon server.js', 'dev script extracted with correct command');
assert(devScript.type === 'SCRIPT', 'Script fact type is SCRIPT');

section('Dependency Extractor — Malformed package.json');

const { dependencies: badDeps, warnings: badWarnings } = extractFromPackageJson('{ invalid json {{', 'broken/package.json');
assert(badDeps.length === 0, 'Malformed JSON returns empty dependencies (no crash)');
assert(badWarnings.length > 0, 'Malformed JSON produces a warning message');

// ======================================================================
// SECTION 6: Documentation Extractor
// ======================================================================
section('Documentation Extractor — Markdown API References');

const readmeContent = `
# CodeAtlas API

## Authentication

### Login
POST /api/auth/login

### Get Current User
GET /api/auth/me

### Logout
DELETE /api/auth/logout

## Users

GET /api/users
POST /api/users/:id

## External Links (should NOT be extracted as endpoints)

See https://github.com/expressjs/express for Express documentation.
Check https://npmjs.com for packages.

## cURL Examples

curl -X GET http://localhost:5000/api/repositories
`.trim();

const { apiEndpoints: docEndpoints, environmentVariables: docEnvVars, warnings: docWarnings } =
  extractFromDocumentation(readmeContent, 'README.md');

assert(docEndpoints.length >= 5, 'Extracted ≥5 documented API endpoints');
assert(docEndpoints.every(e => e.fromDocumentation === true), 'All doc endpoints flagged with fromDocumentation:true');

const docPost = docEndpoints.find(e => e.method === 'POST' && e.path === '/api/auth/login');
assert(!!docPost, 'Documented POST /api/auth/login extracted from Markdown');

const docGet = docEndpoints.find(e => e.method === 'GET' && e.path === '/api/auth/me');
assert(!!docGet, 'Documented GET /api/auth/me extracted from Markdown');

const docDelete = docEndpoints.find(e => e.method === 'DELETE' && e.path === '/api/auth/logout');
assert(!!docDelete, 'Documented DELETE /api/auth/logout extracted from Markdown');

const curlEndpoint = docEndpoints.find(e => e.fromCurl === true);
assert(!!curlEndpoint, 'curl example API endpoint extracted from Markdown');
assert(curlEndpoint.path === '/api/repositories', 'curl example extracts correct path /api/repositories');

// External URLs should NOT be extracted as API endpoints
const githubEndpoint = docEndpoints.find(e => e.path.includes('github.com'));
assert(!githubEndpoint, 'External GitHub URLs are NOT extracted as API endpoints');

section('Documentation Extractor — Environment Variable References');

const envDocContent = `
## Configuration

Set the following environment variables before running:

- \`MONGODB_URI\` — MongoDB connection string
- \`JWT_SECRET\` — JWT signing secret
- \`PORT\` — Application port (default: 5000)
- \`GOOGLE_CLIENT_ID\` — OAuth client ID
`.trim();

const { environmentVariables: docEnvFacts } = extractFromDocumentation(envDocContent, 'docs/setup.md');
const docEnvNames = docEnvFacts.map(f => f.name);
assert(docEnvFacts.length >= 3, 'Extracted ≥3 env vars from documentation');
assert(docEnvNames.includes('MONGODB_URI'), 'MONGODB_URI documented env var extracted');
assert(docEnvNames.includes('JWT_SECRET'), 'JWT_SECRET documented env var extracted');
assert(docEnvNames.includes('PORT'), 'PORT documented env var extracted');

// ======================================================================
// SECTION 7: OpenAPI Extractor
// ======================================================================
section('OpenAPI Extractor — JSON Format');

const openApiJson = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'CodeAtlas API', version: '1.0.0' },
  paths: {
    '/api/users': {
      get: { operationId: 'listUsers', summary: 'List all users' },
      post: { operationId: 'createUser', summary: 'Create a user' },
    },
    '/api/users/{id}': {
      get: { operationId: 'getUser' },
      delete: { operationId: 'deleteUser' },
    },
    '/api/auth/login': {
      post: { operationId: 'login', summary: 'Authenticate user' },
    },
  },
}, null, 2);

const { apiEndpoints: oaJsonEndpoints, warnings: oaJsonWarnings } =
  extractFromOpenApi(openApiJson, 'docs/openapi.json');

assert(oaJsonEndpoints.length === 5, 'Extracted 5 endpoints from OpenAPI JSON');
assert(oaJsonWarnings.length === 0, 'No warnings for valid OpenAPI JSON');

const oaListUsers = oaJsonEndpoints.find(e => e.method === 'GET' && e.path === '/api/users');
assert(!!oaListUsers, 'OpenAPI JSON: GET /api/users extracted');
assert(oaListUsers.operationId === 'listUsers', 'OpenAPI JSON: operationId extracted');
assert(oaListUsers.fromOpenApi === true, 'OpenAPI JSON endpoint flagged with fromOpenApi:true');

const oaDeleteUser = oaJsonEndpoints.find(e => e.method === 'DELETE');
assert(!!oaDeleteUser, 'OpenAPI JSON: DELETE method extracted');

section('OpenAPI Extractor — YAML Format');

const openApiYaml = `
openapi: "3.0.0"
info:
  title: CodeAtlas API
  version: "1.0.0"
paths:
  /api/repositories:
    get:
      operationId: listRepositories
      summary: List repositories
    post:
      operationId: importRepository
      summary: Import a repository
  /api/repositories/{id}:
    get:
      operationId: getRepository
    delete:
      operationId: deleteRepository
components:
  schemas: {}
`.trim();

const { apiEndpoints: oaYamlEndpoints, warnings: oaYamlWarnings } =
  extractFromOpenApi(openApiYaml, 'docs/openapi.yaml');

assert(oaYamlEndpoints.length === 4, `Extracted 4 endpoints from OpenAPI YAML (got ${oaYamlEndpoints.length})`);
const oaYamlGet = oaYamlEndpoints.find(e => e.method === 'GET' && e.path === '/api/repositories');
assert(!!oaYamlGet, 'OpenAPI YAML: GET /api/repositories extracted');
assert(oaYamlGet.operationId === 'listRepositories', 'OpenAPI YAML: operationId extracted');

const oaYamlPost = oaYamlEndpoints.find(e => e.method === 'POST' && e.path === '/api/repositories');
assert(!!oaYamlPost, 'OpenAPI YAML: POST /api/repositories extracted');

section('OpenAPI Extractor — Malformed Spec Handled Safely');

const { apiEndpoints: badOaEndpoints, warnings: badOaWarnings } =
  extractFromOpenApi('{ this is not valid json or yaml at all ###', 'docs/openapi.json');
assert(badOaEndpoints.length === 0, 'Malformed OpenAPI returns empty endpoints (no crash)');
assert(badOaWarnings.length > 0, 'Malformed OpenAPI produces a warning');

// ======================================================================
// SECTION 8: Full Integration Scan with Fixture Repository
// ======================================================================
section('Full Integration Scan — Fixture Repository');

async function runIntegrationTest() {
  const mockProvider = new MockRepositoryProvider();

  mockProvider.addRepository('testowner', 'fullstack-app', {
    commitSha: 'abc123def456',
    files: {
      'README.md': `
# Fullstack App

## API Reference

GET /api/health
POST /api/auth/login
GET /api/users

## Setup

Set \`MONGODB_URI\`, \`JWT_SECRET\`, and \`PORT\` in your environment.
`.trim(),
      'backend/package.json': JSON.stringify({
        name: 'fullstack-backend',
        dependencies: { express: '^5.0.0', mongoose: '^8.0.0' },
        devDependencies: { nodemon: '^3.0.0' },
        scripts: { dev: 'nodemon server.js', test: 'node test.js' },
      }),
      'backend/src/config/index.js': `
const port = process.env.PORT || 5000;
const mongoUri = process.env.MONGODB_URI;
const jwtSecret = process.env.JWT_SECRET;
`.trim(),
      'backend/src/app.js': `
const express = require('express');
const authRouter = require('./routes/authRoutes');
const app = express();
app.use('/api/auth', authRouter);
app.get('/api/health', (req, res) => res.json({ ok: true }));
`.trim(),
      'backend/src/routes/authRoutes.js': `
const router = require('express').Router();
router.post('/login', loginHandler);
router.get('/me', getMeHandler);
router.post('/logout', logoutHandler);
module.exports = router;
`.trim(),
      '.env.example': `
PORT=5000
MONGODB_URI=mongodb://localhost:27017/app
JWT_SECRET=change_me
`.trim(),
      '.env': `
PORT=5000
MONGODB_URI=mongodb+srv://user:secret@prod.example.com/app
JWT_SECRET=super_secret_real_key_never_expose
`.trim(),
      'docs/openapi.yaml': `
openapi: "3.0.0"
info:
  title: App API
  version: "1.0.0"
paths:
  /api/health:
    get:
      operationId: healthCheck
  /api/auth/login:
    post:
      operationId: login
  /api/users:
    get:
      operationId: listUsers
`.trim(),
      'assets/logo.png': { size: 50000 },
    },
  });

  const scanner = new RepositoryScanner(mockProvider, { maxFileSizeBytes: 512 * 1024 });
  const result = await scanner.scan('testowner', 'fullstack-app', 'main');

  console.log('\n  Integration Result:');
  console.log(`    Files in inventory: ${result.statistics.totalFiles}`);
  console.log(`    Excluded secrets: ${result.statistics.excludedSecretFiles}`);
  console.log(`    Code API endpoints: ${result.facts.codeFacts.apiEndpoints.length}`);
  console.log(`    Code env vars: ${result.facts.codeFacts.environmentVariables.length}`);
  console.log(`    Dependencies: ${result.facts.codeFacts.dependencies.length}`);
  console.log(`    Scripts: ${result.facts.codeFacts.scripts.length}`);
  console.log(`    Doc API endpoints: ${result.facts.documentationFacts.apiEndpoints.length}`);
  console.log(`    Doc env vars: ${result.facts.documentationFacts.environmentVariables.length}`);
  console.log(`    Warnings: ${result.facts.warnings.length}`);

  // Top-level structure
  assert(result.facts !== undefined, 'Result contains facts property');
  assert(result.facts.codeFacts !== undefined, 'Result contains facts.codeFacts');
  assert(result.facts.documentationFacts !== undefined, 'Result contains facts.documentationFacts');

  // Security: .env excluded
  assert(result.statistics.excludedSecretFiles === 1, 'Actual .env file excluded from inventory');
  const envInInventory = result.files.some(f => f.path === '.env');
  assert(!envInInventory, 'Actual .env NOT present in file inventory');

  // Code facts: API endpoints from Express (with prefix resolution) + OpenAPI
  const codeApiEndpoints = result.facts.codeFacts.apiEndpoints;
  assert(codeApiEndpoints.length > 0, 'Code API endpoints extracted');

  const healthEndpoint = codeApiEndpoints.find(e => e.method === 'GET' && e.path === '/api/health');
  assert(!!healthEndpoint, 'app.get /api/health extracted in code facts');

  const resolvedLogin = codeApiEndpoints.find(e => e.method === 'POST' && e.path === '/api/auth/login');
  assert(!!resolvedLogin, 'router prefix resolved: POST /api/auth/login in code facts');

  const oaHealthEndpoint = codeApiEndpoints.find(e => e.fromOpenApi && e.path === '/api/health');
  assert(!!oaHealthEndpoint, 'OpenAPI health endpoint in code facts');

  // Code facts: env vars (from source + .env.example template, deduplicated)
  const codeEnvVars = result.facts.codeFacts.environmentVariables;
  assert(codeEnvVars.length > 0, 'Environment variables extracted from code');
  assert(codeEnvVars.some(e => e.name === 'PORT'), 'PORT env var extracted');
  assert(codeEnvVars.some(e => e.name === 'MONGODB_URI'), 'MONGODB_URI env var extracted');
  assert(codeEnvVars.some(e => e.name === 'JWT_SECRET'), 'JWT_SECRET env var extracted');

  // Code facts: dependencies
  const deps = result.facts.codeFacts.dependencies;
  assert(deps.length === 3, '3 dependencies extracted (express, mongoose, nodemon)');
  assert(deps.some(d => d.name === 'express' && d.section === 'dependencies'), 'express runtime dep extracted');

  // Code facts: scripts
  const scripts = result.facts.codeFacts.scripts;
  assert(scripts.length === 2, '2 scripts extracted');

  // Documentation facts: API endpoints from README.md
  const docEndpoints = result.facts.documentationFacts.apiEndpoints;
  assert(docEndpoints.length > 0, 'Documentation API endpoints extracted');
  assert(docEndpoints.some(e => e.method === 'GET' && e.path === '/api/health'), 'Documented GET /api/health found');
  assert(docEndpoints.some(e => e.method === 'POST' && e.path === '/api/auth/login'), 'Documented POST /api/auth/login found');

  // Documentation facts: env vars from README.md
  const docEnvVarsResult = result.facts.documentationFacts.environmentVariables;
  assert(docEnvVarsResult.some(e => e.name === 'MONGODB_URI'), 'MONGODB_URI found in documentation facts');
  assert(docEnvVarsResult.some(e => e.name === 'JWT_SECRET'), 'JWT_SECRET found in documentation facts');

  console.log('\n  ✅ Integration scan PASSED');
}

// ======================================================================
// SECTION 9: Phase 4A Regression Tests
// ======================================================================
section('Phase 4A Regression Tests');

assert(sanitizePath('src/app.js') === 'src/app.js', '[Regression] Path sanitization works');
let traversalBlocked = false;
try { sanitizePath('../../etc/passwd'); } catch { traversalBlocked = true; }
assert(traversalBlocked, '[Regression] Directory traversal blocked');
assert(isExcludedSecretFile('.env') === true, '[Regression] .env secret excluded');
assert(isExcludedSecretFile('.env.example') === false, '[Regression] .env.example permitted');
assert(isBinaryExtension('logo.png') === true, '[Regression] PNG detected as binary');
assert(classifyFile('src/app.js') === CATEGORIES.SOURCE, '[Regression] JS file classified as SOURCE');
assert(classifyFile('README.md') === CATEGORIES.DOCUMENTATION, '[Regression] README.md classified as DOCUMENTATION');
assert(classifyFile('Dockerfile') === CATEGORIES.INFRASTRUCTURE, '[Regression] Dockerfile classified as INFRASTRUCTURE');

// Run async integration test
runIntegrationTest()
  .then(() => {
    console.log(`\n======================================================`);
    console.log(`  ALL ${passed + 1}/${total + 1} PHASE 4B TESTS PASSED!`);
    console.log(`======================================================\n`);
  })
  .catch((err) => {
    console.error('\n❌ Phase 4B Test Suite Failed:', err.message);
    process.exit(1);
  });
