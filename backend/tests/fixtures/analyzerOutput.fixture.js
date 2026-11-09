/**
 * Analyzer Output Fixture
 * Deterministic analyzer response payload for unit and integration testing.
 */

module.exports = {
  sampleAnalyzerOutput: {
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
          { method: 'POST', path: '/v1/auth/login', source: 'src/routes/v1/auth.route.js', line: 12, prefixResolved: true },
          { method: 'GET', path: '/v1/users', source: 'src/routes/v1/user.route.js', line: 15, prefixResolved: true },
        ],
        environmentVariables: [
          { name: 'PORT', source: 'src/config/config.js', line: 10, fromTemplate: false },
          { name: 'MONGODB_URL', source: 'src/config/config.js', line: 12, fromTemplate: false },
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
          { method: 'POST', path: '/v1/auth/login', source: 'docs/api.md', line: 20, fromDocumentation: true },
        ],
        environmentVariables: [
          { name: 'PORT', source: 'README.md', line: 55, fromDocumentation: true },
          { name: 'MONGODB_URL', source: 'README.md', line: 56, fromDocumentation: true },
        ],
      },
    },
    drift: {
      summary: { total: 1, high: 0, medium: 1, low: 0 },
      findings: [
        {
          id: 'FINDING-1',
          type: 'UNDOCUMENTED_API',
          severity: 'MEDIUM',
          title: 'Undocumented API: GET /v1/users',
          message: 'Endpoint exists in source code but is missing from documentation.',
          resource: { method: 'GET', path: '/v1/users' },
          codeEvidence: {
            source: 'src/routes/v1/user.route.js',
            line: 15,
            prefixResolved: true,
          },
          documentationEvidence: null,
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
  },
};

