/**
 * Phase 5B.3.1 — Dependency Mapping and Persistence Regression Suite
 *
 * Tests the mapping of Analyzer dependency facts to the AnalysisResult schema:
 * 1. dependencies → production
 * 2. devDependencies → development
 * 3. peerDependencies → peer
 * 4. optionalDependencies → optional
 * 5. missing section → unknown
 * 6. unrecognized section → unknown
 * 7. Analyzer 'DEPENDENCY' type is NOT passed into schema type enum
 * 8. Dependency name and version preservation
 * 9. Non-string versions handled safely
 * 10. Invalid/empty dependency facts filtered safely
 * 11. Script mapping (name and command preserved)
 * 12. Full AnalysisResult Mongoose document validation with real-world Analyzer output
 * 13. Safety checks: raw files[] and env var values/secrets stripped
 * 14. Invalid analysis data fails safely
 *
 * Run: node scratch/test_dependency_mapping.js
 */

'use strict';

require('dotenv').config();

const mongoose = require('mongoose');
const AnalysisResult = require('../src/models/AnalysisResult');
const {
  mapDependencies,
  mapScripts,
  mapFacts,
  mapEnvVars,
  mapFileCounts,
} = require('../src/services/scanExecutionService');

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

async function runTests() {
  console.log('=============================================================');
  console.log('  Phase 5B.3.1 — Dependency Mapping Regression Suite');
  console.log('=============================================================\n');

  // ─────────────────────────────────────────────────────────────────────────
  // Group 1: Unit Mapping Tests
  // ─────────────────────────────────────────────────────────────────────────
  console.log('Group 1: Section-to-Type Mapping');

  // 1. dependencies → production
  const prodResult = mapDependencies([
    { type: 'DEPENDENCY', name: 'express', version: '^4.17.1', section: 'dependencies' },
  ]);
  assert(prodResult.length === 1, 'dependencies section maps 1 item');
  assert(prodResult[0].type === 'production', 'dependencies maps to type "production"');
  assert(prodResult[0].name === 'express', 'name is preserved');
  assert(prodResult[0].version === '^4.17.1', 'version is preserved');

  // 2. devDependencies → development
  const devResult = mapDependencies([
    { type: 'DEPENDENCY', name: 'jest', version: '^27.0.0', section: 'devDependencies' },
  ]);
  assert(devResult.length === 1, 'devDependencies section maps 1 item');
  assert(devResult[0].type === 'development', 'devDependencies maps to type "development"');
  assert(devResult[0].name === 'jest', 'dev name is preserved');
  assert(devResult[0].version === '^27.0.0', 'dev version is preserved');

  // 3. peerDependencies → peer
  const peerResult = mapDependencies([
    { type: 'DEPENDENCY', name: 'react', version: '>=16.8.0', section: 'peerDependencies' },
  ]);
  assert(peerResult.length === 1, 'peerDependencies section maps 1 item');
  assert(peerResult[0].type === 'peer', 'peerDependencies maps to type "peer"');

  // 4. optionalDependencies → optional
  const optResult = mapDependencies([
    { type: 'DEPENDENCY', name: 'fsevents', version: '^2.3.2', section: 'optionalDependencies' },
  ]);
  assert(optResult.length === 1, 'optionalDependencies section maps 1 item');
  assert(optResult[0].type === 'optional', 'optionalDependencies maps to type "optional"');

  // 5. missing section → unknown
  const missingResult = mapDependencies([
    { type: 'DEPENDENCY', name: 'some-pkg', version: '1.0.0' },
  ]);
  assert(missingResult.length === 1, 'missing section maps 1 item');
  assert(missingResult[0].type === 'unknown', 'missing section maps to type "unknown"');

  // 6. unrecognized section → unknown
  const unrecResult = mapDependencies([
    { type: 'DEPENDENCY', name: 'bundled-pkg', version: '1.0.0', section: 'bundledDependencies' },
  ]);
  assert(unrecResult.length === 1, 'unrecognized section maps 1 item');
  assert(unrecResult[0].type === 'unknown', 'unrecognized section maps to type "unknown"');

  // 7. Analyzer 'DEPENDENCY' fact type is NEVER in schema output type
  const allSections = [
    { type: 'DEPENDENCY', name: 'a', version: '1', section: 'dependencies' },
    { type: 'DEPENDENCY', name: 'b', version: '2', section: 'devDependencies' },
    { type: 'DEPENDENCY', name: 'c', version: '3', section: 'peerDependencies' },
    { type: 'DEPENDENCY', name: 'd', version: '4', section: 'optionalDependencies' },
    { type: 'DEPENDENCY', name: 'e', version: '5' },
    { type: 'DEPENDENCY', name: 'f', version: '6', section: 'invalid' },
  ];
  const mappedAll = mapDependencies(allSections);
  const hasDependencyType = mappedAll.some((d) => d.type === 'DEPENDENCY');
  assert(!hasDependencyType, "Analyzer 'DEPENDENCY' fact type is never passed into schema type");

  // 8. Null/undefined/missing versions handled
  const noVersionResult = mapDependencies([
    { type: 'DEPENDENCY', name: 'no-ver-pkg', section: 'dependencies' },
  ]);
  assert(noVersionResult[0].version === null, 'missing version defaults to null');

  // 9. Invalid/empty inputs
  assert(mapDependencies(null).length === 0, 'null dependencies returns empty array');
  assert(mapDependencies(undefined).length === 0, 'undefined dependencies returns empty array');
  assert(mapDependencies('not-an-array').length === 0, 'string dependencies returns empty array');
  assert(mapDependencies([{ type: 'DEPENDENCY', name: '' }]).length === 0, 'empty name filtered out');

  // 10. Script mapping
  const scriptResult = mapScripts([
    { type: 'SCRIPT', name: 'start', command: 'node server.js', source: 'package.json' },
    { type: 'SCRIPT', name: 'test', command: 'jest' },
    { type: 'SCRIPT', name: 'build' },
  ]);
  assert(scriptResult.length === 3, 'scripts mapped successfully');
  assert(scriptResult[0].name === 'start' && scriptResult[0].command === 'node server.js',
    'script name and command preserved');
  assert(scriptResult[0].source === undefined && scriptResult[0].type === undefined,
    'script extra metadata stripped');
  assert(scriptResult[2].command === null, 'script missing command defaults to null');

  // ─────────────────────────────────────────────────────────────────────────
  // Group 2: Full AnalysisResult Mongoose Schema Validation
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\nGroup 2: Full AnalysisResult Mongoose Validation');

  const sampleAnalyzerOutput = {
    statistics: {
      totalFiles: 78,
      sourceFiles: 49,
      documentationFiles: 5,
      configurationFiles: 10,
      infrastructureFiles: 5,
      buildFiles: 0,
      unknownFiles: 9,
    },
    facts: {
      codeFacts: {
        apiEndpoints: [
          { method: 'POST', path: '/v1/auth/login', source: 'src/routes/v1/auth.route.js', line: 12 },
          { method: 'GET', path: '/v1/users', source: 'src/routes/v1/user.route.js', line: 15 },
        ],
        environmentVariables: [
          { name: 'PORT', file: 'src/config/config.js', line: 10, value: '3000', secret: false },
          { name: 'MONGODB_URL', file: 'src/config/config.js', line: 12, value: 'mongodb://...', secret: true },
        ],
        dependencies: [
          { type: 'DEPENDENCY', name: 'bcryptjs', version: '^2.4.3', section: 'dependencies', source: 'package.json' },
          { type: 'DEPENDENCY', name: 'compression', version: '^1.7.4', section: 'dependencies', source: 'package.json' },
          { type: 'DEPENDENCY', name: 'cors', version: '^2.8.5', section: 'dependencies', source: 'package.json' },
          { type: 'DEPENDENCY', name: 'dotenv', version: '^10.0.0', section: 'dependencies', source: 'package.json' },
          { type: 'DEPENDENCY', name: 'express', version: '^4.17.1', section: 'dependencies', source: 'package.json' },
          { type: 'DEPENDENCY', name: 'eslint', version: '^7.32.0', section: 'devDependencies', source: 'package.json' },
          { type: 'DEPENDENCY', name: 'jest', version: '^27.0.6', section: 'devDependencies', source: 'package.json' },
          { type: 'DEPENDENCY', name: 'supertest', version: '^6.1.4', section: 'devDependencies', source: 'package.json' },
          { type: 'DEPENDENCY', name: 'custom-peer', version: '^1.0.0', section: 'peerDependencies' },
          { type: 'DEPENDENCY', name: 'custom-opt', version: '^1.0.0', section: 'optionalDependencies' },
          { type: 'DEPENDENCY', name: 'unknown-section-pkg', version: '^1.0.0', section: 'other' },
        ],
        scripts: [
          { type: 'SCRIPT', name: 'start', command: 'pm2 start ecosystem.config.json --no-daemon', source: 'package.json' },
          { type: 'SCRIPT', name: 'dev', command: 'cross-env NODE_ENV=development nodemon src/index.js', source: 'package.json' },
          { type: 'SCRIPT', name: 'test', command: 'jest -i --colors --verbose --detectOpenHandles', source: 'package.json' },
        ],
        warnings: ['Some non-fatal warning'],
      },
      documentationFacts: {
        apiEndpoints: [
          { method: 'POST', path: '/v1/auth/login', source: 'docs/api.md', line: 20 },
        ],
        environmentVariables: [
          { name: 'PORT', file: 'README.md', line: 55, value: '3000' },
          { name: 'MONGODB_URL', file: 'README.md', line: 56, value: 'mongodb://secret' },
        ],
      },
    },
    drift: {
      summary: { total: 1, high: 0, medium: 1, low: 0 },
      findings: [
        {
          type: 'UNDOCUMENTED_API',
          severity: 'MEDIUM',
          title: 'Undocumented API: GET /v1/users',
          message: 'Endpoint exists in source code but is missing from documentation.',
          resource: 'GET /v1/users',
        },
      ],
    },
    importantFiles: {
      readme: { exists: true, path: 'README.md' },
      license: { exists: true, path: 'LICENSE' },
    },
    files: [
      { path: 'src/index.js', content: 'console.log("SECRET FILE CONTENT")' },
      { path: 'package.json', content: '{"name": "test"}' },
    ],
  };

  const fileCounts = mapFileCounts(sampleAnalyzerOutput.statistics);
  const facts = mapFacts(sampleAnalyzerOutput.facts);

  const testDoc = new AnalysisResult({
    scanId: new mongoose.Types.ObjectId(),
    repositoryId: new mongoose.Types.ObjectId(),
    userId: new mongoose.Types.ObjectId(),
    branch: 'master',
    commitSha: '179ae84efec61b14206d0305d941daed6c6d07f9',
    analyzerVersion: '1.0.0',
    fileCounts,
    facts,
    drift: sampleAnalyzerOutput.drift,
    importantFiles: sampleAnalyzerOutput.importantFiles,
    warnings: sampleAnalyzerOutput.facts.codeFacts.warnings,
  });

  const validationError = testDoc.validateSync();
  assert(validationError === undefined, 'AnalysisResult passes Mongoose validation with mapped facts');

  // Verify dependencies inside document
  const savedDeps = testDoc.facts.code.dependencies;
  assert(savedDeps.length === 11, 'All 11 dependencies preserved in document');

  const bcryptDep = savedDeps.find((d) => d.name === 'bcryptjs');
  assert(bcryptDep && bcryptDep.type === 'production' && bcryptDep.version === '^2.4.3',
    'bcryptjs correctly mapped to type "production"');

  const jestDep = savedDeps.find((d) => d.name === 'jest');
  assert(jestDep && jestDep.type === 'development' && jestDep.version === '^27.0.6',
    'jest correctly mapped to type "development"');

  const peerDep = savedDeps.find((d) => d.name === 'custom-peer');
  assert(peerDep && peerDep.type === 'peer', 'custom-peer correctly mapped to type "peer"');

  const optDep = savedDeps.find((d) => d.name === 'custom-opt');
  assert(optDep && optDep.type === 'optional', 'custom-opt correctly mapped to type "optional"');

  const unkDep = savedDeps.find((d) => d.name === 'unknown-section-pkg');
  assert(unkDep && unkDep.type === 'unknown', 'unknown section correctly mapped to type "unknown"');

  // ─────────────────────────────────────────────────────────────────────────
  // Group 3: Security & Structural Invariants
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\nGroup 3: Security & Structural Contracts');

  // 1. Env vars have no values or secrets
  const codeEnvVars = testDoc.facts.code.envVars;
  const docEnvVars = testDoc.facts.documentation.envVars;
  const allEnvVars = [...codeEnvVars, ...docEnvVars];
  const hasEnvValues = allEnvVars.some((ev) => ev.value !== undefined || ev.secret !== undefined);
  assert(!hasEnvValues, 'Environment variable values and secrets are stripped');
  assert(allEnvVars.every((ev) => typeof ev.name === 'string'), 'All env vars have names');

  // 2. Raw files[] content is NOT persisted
  const docObj = testDoc.toObject();
  assert(docObj.files === undefined, 'Raw files[] array is NOT in AnalysisResult schema');

  // 3. File counts match statistics
  assert(testDoc.fileCounts.total === 78, 'fileCounts.total matches statistics (78)');
  assert(testDoc.fileCounts.source === 49, 'fileCounts.source matches statistics (49)');
  assert(testDoc.fileCounts.documentation === 5, 'fileCounts.documentation matches statistics (5)');

  // 4. Important files and warnings preserved
  assert(testDoc.importantFiles.readme.exists === true, 'importantFiles preserved');
  assert(testDoc.warnings.length === 1 && testDoc.warnings[0] === 'Some non-fatal warning',
    'warnings array preserved');

  // ─────────────────────────────────────────────────────────────────────────
  // Group 4: Safety & Validation Failure Handling
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\nGroup 4: Safe Rejection of Invalid Data');

  // Missing required scanId
  const missingScanIdDoc = new AnalysisResult({
    repositoryId: new mongoose.Types.ObjectId(),
    userId: new mongoose.Types.ObjectId(),
    analyzerVersion: '1.0.0',
  });
  const missingScanIdErr = missingScanIdDoc.validateSync();
  assert(missingScanIdErr && missingScanIdErr.errors['scanId'], 'Missing scanId is rejected');

  // Invalid finding severity
  const invalidSeverityDoc = new AnalysisResult({
    scanId: new mongoose.Types.ObjectId(),
    repositoryId: new mongoose.Types.ObjectId(),
    userId: new mongoose.Types.ObjectId(),
    analyzerVersion: '1.0.0',
    drift: {
      summary: { total: 1, high: 0, medium: 0, low: 0 },
      findings: [{
        id: 'F1',
        type: 'UNDOCUMENTED_API_ENDPOINT',
        severity: 'critical_super_severe', // invalid enum
        title: 'Title',
        description: 'Desc',
        entity: 'E',
      }],
    },
  });
  const invalidSevErr = invalidSeverityDoc.validateSync();
  assert(invalidSevErr && invalidSevErr.errors['drift.findings.0.severity'],
    'Invalid finding severity is rejected');

  // ─────────────────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n=============================================================');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('=============================================================\n');

  if (failures.length > 0) {
    console.error('Failures:');
    failures.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  }

  console.log('All Dependency Mapping regression tests passed!\n');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('\nFatal error in test suite:', err);
  process.exit(1);
});
