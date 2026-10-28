/**
 * Phase 5A — Deterministic Drift Detection Engine Test Suite
 *
 * Tests: 27 total
 *   - Unit: findingFactory (schema validation)
 *   - Unit: apiDriftDetector (rules A and B)
 *   - Unit: envDriftDetector (rules A and B)
 *   - Unit: driftDetector (orchestrator)
 *   - Integration: full fixture repository scan with drift
 *   - Regression: Phase 4A and 4B test suites
 */

const {
  detectDrift,
  detectApiDrift,
  detectEnvDrift,
  createFinding,
  buildDriftResult,
  RepositoryScanner,
  MockRepositoryProvider,
  // Phase 4B regression
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
    throw new Error(`Assertion failed: ${message}`);
  }
  passed++;
  console.log(`  ✅ ${message}`);
}

function section(title) {
  console.log(`\n--- ${title} ---`);
}

// ======================================================================
// SECTION 1: Finding Factory — Schema Validation
// ======================================================================
section('Finding Factory — Schema Validation');

const validFinding = createFinding({
  type: 'UNDOCUMENTED_API',
  severity: 'HIGH',
  title: 'Undocumented API endpoint',
  message: 'GET /api/users exists in source code but was not found in documentation.',
  resource: { method: 'GET', path: '/api/users' },
  codeEvidence: { source: 'src/routes/api.js', line: 12 },
  documentationEvidence: null,
});

assert(validFinding.type === 'UNDOCUMENTED_API', 'Finding type is UNDOCUMENTED_API');
assert(validFinding.severity === 'HIGH', 'Finding severity is HIGH');
assert(typeof validFinding.title === 'string', 'Finding title is a string');
assert(typeof validFinding.message === 'string', 'Finding message is a string');
assert(validFinding.resource.method === 'GET', 'Finding resource contains method');
assert(validFinding.resource.path === '/api/users', 'Finding resource contains path');
assert(validFinding.codeEvidence.source === 'src/routes/api.js', 'Finding codeEvidence contains source');
assert(validFinding.codeEvidence.line === 12, 'Finding codeEvidence contains line');
assert(validFinding.documentationEvidence === null, 'documentationEvidence is null when absent');

// Immutability
try {
  validFinding.severity = 'LOW';
} catch { /* expected in strict mode */ }
assert(validFinding.severity === 'HIGH', 'Finding is frozen/immutable');

// Invalid type
let invalidTypeError = false;
try { createFinding({ type: 'UNKNOWN_TYPE', severity: 'HIGH', title: 'X', message: 'Y', resource: {} }); }
catch { invalidTypeError = true; }
assert(invalidTypeError, 'Invalid finding type throws an error');

// Invalid severity
let invalidSeverityError = false;
try { createFinding({ type: 'UNDOCUMENTED_API', severity: 'CRITICAL', title: 'X', message: 'Y', resource: {} }); }
catch { invalidSeverityError = true; }
assert(invalidSeverityError, 'Invalid severity throws an error');

// buildDriftResult summary
const summaryResult = buildDriftResult([
  createFinding({ type: 'UNDOCUMENTED_API', severity: 'HIGH', title: 'T', message: 'M', resource: {} }),
  createFinding({ type: 'OBSOLETE_API_DOCUMENTATION', severity: 'MEDIUM', title: 'T', message: 'M', resource: {} }),
  createFinding({ type: 'OBSOLETE_ENVIRONMENT_VARIABLE', severity: 'LOW', title: 'T', message: 'M', resource: {} }),
]);
assert(summaryResult.summary.total === 3, 'Summary total = 3');
assert(summaryResult.summary.high === 1, 'Summary HIGH = 1');
assert(summaryResult.summary.medium === 1, 'Summary MEDIUM = 1');
assert(summaryResult.summary.low === 1, 'Summary LOW = 1');

// ======================================================================
// SECTION 2: API Drift Detector — Rule A (Undocumented)
// ======================================================================
section('API Drift Detector — UNDOCUMENTED_API (Rule A)');

// Test 1: Matching endpoint → no finding
const t1findings = detectApiDrift(
  [{ method: 'GET', path: '/api/users', source: 'src/api.js', line: 1 }],
  [{ method: 'GET', path: '/api/users', source: 'README.md', line: 10 }]
);
assert(t1findings.length === 0, '(T1) Matching GET endpoint produces no finding');

// Test 2: Matching POST endpoint → no finding
const t2findings = detectApiDrift(
  [{ method: 'POST', path: '/api/auth/login', source: 'src/api.js', line: 1 }],
  [{ method: 'POST', path: '/api/auth/login', source: 'README.md', line: 20 }]
);
assert(t2findings.length === 0, '(T2) Matching POST endpoint produces no finding');

// Test 3: Code endpoint missing from docs → UNDOCUMENTED_API
const t3findings = detectApiDrift(
  [{ method: 'POST', path: '/api/auth/login', source: 'src/authRoutes.js', line: 42 }],
  []
);
assert(t3findings.length === 1, '(T3) Missing doc endpoint produces 1 finding');
assert(t3findings[0].type === 'UNDOCUMENTED_API', '(T3) Finding type is UNDOCUMENTED_API');
assert(t3findings[0].severity === 'HIGH', '(T3) Severity is HIGH');
assert(t3findings[0].resource.method === 'POST', '(T3) Resource method is POST');
assert(t3findings[0].resource.path === '/api/auth/login', '(T3) Resource path is /api/auth/login');
assert(t3findings[0].codeEvidence.source === 'src/authRoutes.js', '(T3) Code evidence contains source file');
assert(t3findings[0].codeEvidence.line === 42, '(T3) Code evidence contains line number');
assert(t3findings[0].documentationEvidence === null, '(T3) documentationEvidence is null');

// Test 5: Different HTTP methods are NOT equivalent
const t5findings = detectApiDrift(
  [{ method: 'POST', path: '/api/users', source: 'src/api.js', line: 1 }],
  [{ method: 'GET',  path: '/api/users', source: 'README.md', line: 1 }]
);
assert(t5findings.length > 0, '(T5) Different HTTP methods are not treated as equivalent');
const t5Types = t5findings.map(f => f.type);
assert(t5Types.includes('UNDOCUMENTED_API'), '(T5) POST without doc → UNDOCUMENTED_API');

// Test 6: Different paths are NOT equivalent
const t6findings = detectApiDrift(
  [{ method: 'GET', path: '/api/users', source: 'src/api.js', line: 1 }],
  [{ method: 'GET', path: '/api/posts', source: 'README.md', line: 1 }]
);
assert(t6findings.length === 2, '(T6) Different paths → 2 findings (one undocumented, one obsolete)');

// Test 7: Trailing slash normalization (paths should already be normalized by Phase 4B)
const t7findings = detectApiDrift(
  [{ method: 'GET', path: '/api/users', source: 'src/api.js', line: 1 }],
  [{ method: 'GET', path: '/api/users', source: 'README.md', line: 1 }]
);
assert(t7findings.length === 0, '(T7) Normalized paths match correctly');

// Test 8: Duplicate doc references → single finding (deduplication)
const t8findings = detectApiDrift(
  [],  // no code endpoints
  [
    { method: 'DELETE', path: '/api/users/:id', source: 'README.md', line: 75 },
    { method: 'DELETE', path: '/api/users/:id', source: 'docs/api.md', line: 12 },
  ]
);
assert(t8findings.length === 1, '(T8) Duplicate doc references produce only 1 finding');
assert(t8findings[0].type === 'OBSOLETE_API_DOCUMENTATION', '(T8) Finding type is OBSOLETE_API_DOCUMENTATION');

// Test 9: Code evidence in finding
const t9findings = detectApiDrift(
  [{ method: 'PUT', path: '/api/users/:id', source: 'src/userRoutes.js', line: 30 }],
  []
);
assert(t9findings[0].codeEvidence !== null, '(T9) Finding contains codeEvidence');
assert(t9findings[0].codeEvidence.source === 'src/userRoutes.js', '(T9) Code evidence source correct');

// Test 10: Documentation evidence in finding (obsolete doc)
const t10findings = detectApiDrift(
  [],
  [{ method: 'DELETE', path: '/api/users/:id', source: 'README.md', line: 75, fromDocumentation: true }]
);
assert(t10findings[0].documentationEvidence !== null, '(T10) Finding contains documentationEvidence');
assert(t10findings[0].documentationEvidence.source === 'README.md', '(T10) Doc evidence source correct');
assert(t10findings[0].documentationEvidence.line === 75, '(T10) Doc evidence line correct');

// ======================================================================
// SECTION 3: API Drift Detector — Rule B (Obsolete Documentation)
// ======================================================================
section('API Drift Detector — OBSOLETE_API_DOCUMENTATION (Rule B)');

// Test 4: Documentation endpoint missing from code → OBSOLETE_API_DOCUMENTATION
const t4findings = detectApiDrift(
  [],
  [{ method: 'DELETE', path: '/api/users/:id', source: 'README.md', line: 75 }]
);
assert(t4findings.length === 1, '(T4) Obsolete doc endpoint produces 1 finding');
assert(t4findings[0].type === 'OBSOLETE_API_DOCUMENTATION', '(T4) Finding type is OBSOLETE_API_DOCUMENTATION');
assert(t4findings[0].severity === 'MEDIUM', '(T4) Severity is MEDIUM');
assert(t4findings[0].resource.method === 'DELETE', '(T4) Resource method is DELETE');
assert(t4findings[0].codeEvidence === null, '(T4) codeEvidence is null');
assert(t4findings[0].documentationEvidence !== null, '(T4) documentationEvidence is present');

// Conservative language check
assert(
  t4findings[0].message.includes('was not found') || t4findings[0].message.includes('not found'),
  '(T4) Message uses conservative language (was not found)'
);
assert(
  !t4findings[0].message.toLowerCase().includes('does not exist'),
  '(T4) Message does NOT claim endpoint "does not exist"'
);

// ======================================================================
// SECTION 4: Environment Variable Drift Detector
// ======================================================================
section('Env Var Drift Detector — UNDOCUMENTED_ENVIRONMENT_VARIABLE (Rule A)');

// Test 11: Code env var that IS documented → no finding
const t11findings = detectEnvDrift(
  [{ name: 'MONGODB_URI', source: 'src/config.js', line: 3 }],
  [{ name: 'MONGODB_URI', source: 'README.md', line: 15 }]
);
assert(t11findings.length === 0, '(T11) Documented env var produces no finding');

// Test 12: Code env var NOT in documentation → UNDOCUMENTED_ENVIRONMENT_VARIABLE
const t12findings = detectEnvDrift(
  [{ name: 'REDIS_URL', source: 'src/cache.js', line: 8 }],
  []
);
assert(t12findings.length === 1, '(T12) Undocumented env var produces 1 finding');
assert(t12findings[0].type === 'UNDOCUMENTED_ENVIRONMENT_VARIABLE', '(T12) Finding type is UNDOCUMENTED_ENVIRONMENT_VARIABLE');
assert(t12findings[0].severity === 'MEDIUM', '(T12) Severity is MEDIUM');
assert(t12findings[0].resource.name === 'REDIS_URL', '(T12) Resource contains variable name');
assert(t12findings[0].codeEvidence.source === 'src/cache.js', '(T12) Code evidence source present');
assert(t12findings[0].codeEvidence.line === 8, '(T12) Code evidence line present');
assert(t12findings[0].documentationEvidence === null, '(T12) documentationEvidence is null');

// Test 13: Documented env var NOT in code → OBSOLETE_ENVIRONMENT_VARIABLE
const t13findings = detectEnvDrift(
  [],
  [{ name: 'OLD_API_KEY', source: 'README.md', line: 25, fromDocumentation: true }]
);
assert(t13findings.length === 1, '(T13) Obsolete env var produces 1 finding');
assert(t13findings[0].type === 'OBSOLETE_ENVIRONMENT_VARIABLE', '(T13) Finding type is OBSOLETE_ENVIRONMENT_VARIABLE');
assert(t13findings[0].severity === 'LOW', '(T13) Severity is LOW');
assert(t13findings[0].resource.name === 'OLD_API_KEY', '(T13) Resource contains variable name');
assert(t13findings[0].codeEvidence === null, '(T13) codeEvidence is null');
assert(t13findings[0].documentationEvidence !== null, '(T13) documentationEvidence is present');

// Conservative language check for env
assert(
  t13findings[0].message.includes('was not found') || t13findings[0].message.includes('not found'),
  '(T13) Message uses conservative language (was not found)'
);

// Test 14: Env variable VALUES are never exposed in findings
const t14findings = detectEnvDrift(
  [{ name: 'SECRET_KEY', value: 'super_secret_value_12345', source: 'src/auth.js', line: 5 }],
  []
);
assert(t14findings.length === 1, '(T14) Finding generated');
const t14json = JSON.stringify(t14findings[0]);
assert(!t14json.includes('super_secret_value_12345'), '(T14) Variable VALUE is never exposed in finding');

// ======================================================================
// SECTION 5: Severity Rules
// ======================================================================
section('Severity Rules');

const severityFindings = detectApiDrift(
  [{ method: 'POST', path: '/api/secret', source: 'src/api.js', line: 1 }],
  [{ method: 'GET',  path: '/api/gone',  source: 'README.md',  line: 1 }]
);
const undocumented = severityFindings.find(f => f.type === 'UNDOCUMENTED_API');
const obsolete     = severityFindings.find(f => f.type === 'OBSOLETE_API_DOCUMENTATION');

// Test 15: Undocumented API → HIGH
assert(undocumented && undocumented.severity === 'HIGH', '(T15) UNDOCUMENTED_API severity is HIGH');

// Test 16: Obsolete API documentation → MEDIUM
assert(obsolete && obsolete.severity === 'MEDIUM', '(T16) OBSOLETE_API_DOCUMENTATION severity is MEDIUM');

// Test 17: Undocumented env var → MEDIUM
const t17findings = detectEnvDrift(
  [{ name: 'NEW_VAR', source: 'src/app.js', line: 1 }], []
);
assert(t17findings[0].severity === 'MEDIUM', '(T17) UNDOCUMENTED_ENVIRONMENT_VARIABLE severity is MEDIUM');

// Test 18: Obsolete env var → LOW
const t18findings = detectEnvDrift(
  [],
  [{ name: 'OLD_VAR', source: 'README.md', line: 1 }]
);
assert(t18findings[0].severity === 'LOW', '(T18) OBSOLETE_ENVIRONMENT_VARIABLE severity is LOW');

// ======================================================================
// SECTION 6: Drift Result Structure and Warnings Separation
// ======================================================================
section('Drift Orchestrator — Result Structure and Warnings Separation');

const orchestratorFacts = {
  codeFacts: {
    apiEndpoints: [
      { method: 'GET', path: '/api/users', source: 'src/api.js', line: 1 },         // matched
      { method: 'POST', path: '/api/users', source: 'src/api.js', line: 2 },         // undocumented
    ],
    environmentVariables: [
      { name: 'PORT', source: 'src/config.js', line: 1 },                            // matched
      { name: 'REDIS_URL', source: 'src/cache.js', line: 5 },                        // undocumented
    ],
    dependencies: [{ type: 'DEPENDENCY', name: 'express', version: '^5.0.0', section: 'dependencies' }],
    scripts: [],
  },
  documentationFacts: {
    apiEndpoints: [
      { method: 'GET',    path: '/api/users', source: 'README.md', line: 10 },       // matched
      { method: 'DELETE', path: '/api/users', source: 'README.md', line: 20 },       // obsolete
    ],
    environmentVariables: [
      { name: 'PORT', source: 'README.md', line: 5 },                                // matched
      { name: 'OLD_KEY', source: 'README.md', line: 8 },                             // obsolete
    ],
  },
  warnings: ['[test] A parsing warning that is NOT a finding'],
};

const orchestratorResult = detectDrift(orchestratorFacts);

// Test 19: Summary counts correct
assert(orchestratorResult.summary.total === 4, '(T19) Summary total = 4 (POST undocumented + DELETE obsolete + REDIS_URL undocumented + OLD_KEY obsolete)');
assert(orchestratorResult.summary.high === 1, '(T19) Summary HIGH = 1');
assert(orchestratorResult.summary.medium === 2, '(T19) Summary MEDIUM = 2');
assert(orchestratorResult.summary.low === 1, '(T19) Summary LOW = 1');

// Test 20: Total equals number of findings
assert(orchestratorResult.summary.total === orchestratorResult.findings.length, '(T20) summary.total === findings.length');

// Test 21: Warnings are separate from findings
assert(!orchestratorResult.findings.some(f => f.message && f.message.includes('parsing warning')),
  '(T21) Extraction warnings do NOT appear in drift findings');
assert(orchestratorResult.findings.every(f => f.type !== undefined), '(T21) All findings have a type');

// ======================================================================
// SECTION 7: Full Integration Scan with Drift
// ======================================================================
section('Full Integration Scan with Drift Detection');

async function runIntegrationTest() {
  const mockProvider = new MockRepositoryProvider();

  mockProvider.addRepository('driftowner', 'drift-app', {
    commitSha: 'drift123abc',
    files: {
      'README.md': `
# Drift App API

## Endpoints

GET /api/health
POST /api/auth/login
GET /api/users

## Environment Variables

Set \`MONGODB_URI\`, \`PORT\`, and \`JWT_SECRET\`.
Also set \`OLD_DEPRECATED_VAR\` (legacy, may be removed).
`.trim(),

      'backend/src/app.js': `
const express = require('express');
const authRouter = require('./routes/authRoutes');
const app = express();
// Internal admin endpoint — intentionally undocumented
app.get('/api/admin/stats', adminHandler);
app.use('/api/auth', authRouter);
app.get('/api/health', (req, res) => res.json({ ok: true }));
`.trim(),

      'backend/src/routes/authRoutes.js': `
const router = require('express').Router();
router.post('/login', loginHandler);
router.get('/me', getMeHandler);
module.exports = router;
`.trim(),

      'backend/src/config/index.js': `
const port = process.env.PORT || 5000;
const mongoUri = process.env.MONGODB_URI;
const jwtSecret = process.env.JWT_SECRET;
const newService = process.env.NEW_SERVICE_KEY;
`.trim(),

      '.env.example': `
PORT=5000
MONGODB_URI=mongodb://localhost
JWT_SECRET=change_me
`.trim(),

      '.env': 'PORT=5000\nMONGODB_URI=real_secret\nJWT_SECRET=real_secret_jwt',

      'package.json': JSON.stringify({
        name: 'drift-app',
        dependencies: { express: '^5.0.0' },
        scripts: { dev: 'nodemon server.js' },
      }),
    },
  });

  const scanner = new RepositoryScanner(new MockRepositoryProvider());
  // Use a fresh instance with our provider
  const { RepositoryScanner: RS } = require('../src/index');
  const provider = mockProvider;
  const sc = new RS(provider);
  const result = await sc.scan('driftowner', 'drift-app', 'main');

  console.log('\n  Integration Scan:');
  console.log(`    Code API endpoints: ${result.facts.codeFacts.apiEndpoints.length}`);
  console.log(`    Doc API endpoints: ${result.facts.documentationFacts.apiEndpoints.length}`);
  console.log(`    Code env vars: ${result.facts.codeFacts.environmentVariables.length}`);
  console.log(`    Doc env vars: ${result.facts.documentationFacts.environmentVariables.length}`);
  console.log(`    Drift findings: ${result.drift.summary.total}`);
  console.log(`      HIGH:   ${result.drift.summary.high}`);
  console.log(`      MEDIUM: ${result.drift.summary.medium}`);
  console.log(`      LOW:    ${result.drift.summary.low}`);
  console.log('    Findings:');
  for (const f of result.drift.findings) {
    console.log(`      [${f.severity}] ${f.type}: ${f.message}`);
  }

  // Test 22: Full fixture scan produces expected drift structure
  assert(result.drift !== undefined, '(T22) Result contains drift property');
  assert(result.drift.summary !== undefined, '(T22) Drift contains summary');
  assert(Array.isArray(result.drift.findings), '(T22) Drift contains findings array');
  assert(result.drift.summary.total === result.drift.findings.length, '(T22) Drift summary.total matches findings.length');

  // Internal endpoint /api/admin/stats is undocumented
  const adminFinding = result.drift.findings.find(f =>
    f.type === 'UNDOCUMENTED_API' && f.resource.path === '/api/admin/stats'
  );
  assert(!!adminFinding, '(T22) /api/admin/stats (internal, undocumented) → UNDOCUMENTED_API finding');
  assert(adminFinding.severity === 'HIGH', '(T22) Admin endpoint finding severity is HIGH');

  // NEW_SERVICE_KEY used in code but not in docs
  const newKeyFinding = result.drift.findings.find(f =>
    f.type === 'UNDOCUMENTED_ENVIRONMENT_VARIABLE' && f.resource.name === 'NEW_SERVICE_KEY'
  );
  assert(!!newKeyFinding, '(T22) NEW_SERVICE_KEY (undocumented in docs) → UNDOCUMENTED_ENVIRONMENT_VARIABLE');

  // OLD_DEPRECATED_VAR documented but not in code
  const oldVarFinding = result.drift.findings.find(f =>
    f.type === 'OBSOLETE_ENVIRONMENT_VARIABLE' && f.resource.name === 'OLD_DEPRECATED_VAR'
  );
  assert(!!oldVarFinding, '(T22) OLD_DEPRECATED_VAR (obsolete in docs) → OBSOLETE_ENVIRONMENT_VARIABLE');

  // .env NOT in file inventory
  assert(result.statistics.excludedSecretFiles >= 1, '(T22) .env secret file excluded from inventory');
  assert(!result.files.some(f => f.path === '.env'), '(T22) .env never in file inventory');

  // Warnings separate from findings
  assert(!result.drift.findings.some(f => typeof f.type === 'undefined'), '(T22) All findings have type field');

  console.log('\n  ✅ Integration scan with drift PASSED');
}

// ======================================================================
// SECTION 8: Phase 4A/4B Regression
// ======================================================================
section('Phase 4A & 4B Regression Tests');

assert(sanitizePath('src/app.js') === 'src/app.js', '[Regression 4A] Path sanitization works');
assert(isExcludedSecretFile('.env') === true, '[Regression 4A] .env secret excluded');
assert(isExcludedSecretFile('.env.example') === false, '[Regression 4A] .env.example permitted');
assert(isBinaryExtension('logo.png') === true, '[Regression 4A] PNG detected as binary');
assert(classifyFile('src/app.js') === CATEGORIES.SOURCE, '[Regression 4A] JS classified as SOURCE');
assert(classifyFile('README.md') === CATEGORIES.DOCUMENTATION, '[Regression 4A] README classified as DOCUMENTATION');

// detectDrift with empty facts doesn't crash
const emptyDrift = detectDrift({});
assert(emptyDrift.summary.total === 0, '[Regression 4B] detectDrift with empty facts returns 0 findings');
const nullDrift = detectDrift(null);
assert(nullDrift.summary.total === 0, '[Regression 4B] detectDrift with null facts returns 0 findings');

// Run async integration
runIntegrationTest()
  .then(() => {
    console.log(`\n======================================================`);
    console.log(`  ALL ${passed}/${total} PHASE 5A TESTS PASSED!`);
    console.log(`======================================================\n`);
  })
  .catch((err) => {
    console.error('\n❌ Phase 5A Test Suite Failed:', err.message);
    process.exit(1);
  });
