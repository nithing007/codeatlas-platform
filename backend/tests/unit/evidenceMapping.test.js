/**
 * Unit Tests: Evidence and Extracted Fact Mapping
 * Migrated from backend/scratch/test_phase7a2b.js (Groups 1 - 4).
 * Preserves all 13 original assertions.
 */

const mongoose = require('mongoose');
const AnalysisResult = require('../../src/models/AnalysisResult');
const {
  mapEnvVars,
  mapApiEndpoints,
  mapEvidence,
  mapDrift,
  mapFacts,
} = require('../../src/services/scanExecutionService');

describe('Evidence and Fact Source Mapping (Phase 7A.2B)', () => {
  describe('Group 1: Evidence Source-to-File Mapping', () => {
    test('mapEvidence maps analyzer source into file and retains source', () => {
      const raw = { source: 'src/routes/auth.js', line: 42 };
      const mapped = mapEvidence(raw);
      expect(mapped.file).toBe('src/routes/auth.js');
      expect(mapped.source).toBe('src/routes/auth.js');
      expect(mapped.line).toBe(42);
    });

    test('mapEvidence handles backward-compatible file property', () => {
      const raw = { file: 'src/controllers/user.js', line: 15 };
      const mapped = mapEvidence(raw);
      expect(mapped.file).toBe('src/controllers/user.js');
      expect(mapped.source).toBe('src/controllers/user.js');
      expect(mapped.line).toBe(15);
    });

    test('mapEvidence handles null / undefined evidence safely', () => {
      expect(mapEvidence(null)).toBeNull();
      expect(mapEvidence(undefined)).toBeNull();
      expect(mapEvidence('invalid')).toBeNull();
    });

    test('mapEvidence preserves HTTP method and path metadata', () => {
      const raw = { source: 'routes.js', line: 10, method: 'POST', path: '/api/v1/auth' };
      const mapped = mapEvidence(raw);
      expect(mapped.method).toBe('POST');
      expect(mapped.path).toBe('/api/v1/auth');
    });

    test('mapEvidence preserves environment variable name', () => {
      const raw = { source: '.env.example', line: 5, name: 'PORT' };
      const mapped = mapEvidence(raw);
      expect(mapped.name).toBe('PORT');
    });
  });

  describe('Group 2: Evidence Context Flag Persistence', () => {
    test('mapEvidence preserves code evidence flags (prefixResolved, fromTemplate, fromOpenApi)', () => {
      const raw = {
        source: 'src/routes.js',
        line: 20,
        prefixResolved: true,
        fromTemplate: true,
        fromOpenApi: true,
      };
      const mapped = mapEvidence(raw);
      expect(mapped.prefixResolved).toBe(true);
      expect(mapped.fromTemplate).toBe(true);
      expect(mapped.fromOpenApi).toBe(true);
    });

    test('mapEvidence preserves doc evidence flags (fromCurl, fromTable, fromOpenApi, fromDocumentation)', () => {
      const raw = {
        source: 'README.md',
        line: 88,
        fromCurl: true,
        fromTable: true,
        fromOpenApi: true,
        fromDocumentation: true,
      };
      const mapped = mapEvidence(raw);
      expect(mapped.fromCurl).toBe(true);
      expect(mapped.fromTable).toBe(true);
      expect(mapped.fromOpenApi).toBe(true);
      expect(mapped.fromDocumentation).toBe(true);
    });

    test('mapDrift maps findings and evidence objects correctly', () => {
      const rawDrift = {
        summary: { total: 1, high: 1, medium: 0, low: 0 },
        findings: [
          {
            type: 'UNDOCUMENTED_API',
            severity: 'HIGH',
            title: 'Undocumented API',
            message: 'Route not found in docs',
            resource: { method: 'POST', path: '/api/users' },
            codeEvidence: { source: 'src/users.js', line: 12, prefixResolved: true },
            documentationEvidence: null,
          },
        ],
      };
      const mapped = mapDrift(rawDrift);
      expect(mapped.summary.total).toBe(1);
      expect(mapped.findings.length).toBe(1);
      expect(mapped.findings[0].codeEvidence.file).toBe('src/users.js');
      expect(mapped.findings[0].codeEvidence.prefixResolved).toBe(true);
      expect(mapped.findings[0].documentationEvidence).toBeNull();
    });

    test('AnalysisResult Mongoose schema preserves context flags on document cast', () => {
      const doc = new AnalysisResult({
        scanId: new mongoose.Types.ObjectId(),
        repositoryId: new mongoose.Types.ObjectId(),
        userId: new mongoose.Types.ObjectId(),
        analyzerVersion: '1.0.0',
        drift: {
          summary: { total: 1, high: 1, medium: 0, low: 0 },
          findings: [
            {
              type: 'UNDOCUMENTED_API',
              severity: 'HIGH',
              title: 'Undocumented API',
              message: 'Message',
              resource: { method: 'POST', path: '/api/test' },
              codeEvidence: {
                file: 'src/app.js',
                source: 'src/app.js',
                line: 14,
                prefixResolved: true,
                fromTemplate: true,
                fromOpenApi: true,
              },
              documentationEvidence: {
                file: 'README.md',
                source: 'README.md',
                line: 30,
                fromCurl: true,
                fromTable: true,
                fromOpenApi: true,
                fromDocumentation: true,
              },
            },
          ],
        },
      });

      const finding = doc.drift.findings[0];
      expect(finding.codeEvidence.file).toBe('src/app.js');
      expect(finding.codeEvidence.source).toBe('src/app.js');
      expect(finding.codeEvidence.prefixResolved).toBe(true);
      expect(finding.codeEvidence.fromTemplate).toBe(true);
      expect(finding.codeEvidence.fromOpenApi).toBe(true);

      expect(finding.documentationEvidence.file).toBe('README.md');
      expect(finding.documentationEvidence.source).toBe('README.md');
      expect(finding.documentationEvidence.fromCurl).toBe(true);
      expect(finding.documentationEvidence.fromTable).toBe(true);
      expect(finding.documentationEvidence.fromOpenApi).toBe(true);
      expect(finding.documentationEvidence.fromDocumentation).toBe(true);
    });
  });

  describe('Group 3: Extracted Fact Source-to-File Mapping', () => {
    test('mapApiEndpoints maps source to file and source', () => {
      const endpoints = [
        { method: 'GET', path: '/health', source: 'src/routes/health.js', line: 10 },
      ];
      const mapped = mapApiEndpoints(endpoints);
      expect(mapped[0].file).toBe('src/routes/health.js');
      expect(mapped[0].source).toBe('src/routes/health.js');
      expect(mapped[0].method).toBe('GET');
      expect(mapped[0].path).toBe('/health');
      expect(mapped[0].line).toBe(10);
    });

    test('mapEnvVars maps source to file and source (without secrets)', () => {
      const envVars = [
        { name: 'PORT', source: '.env.example', line: 2 },
      ];
      const mapped = mapEnvVars(envVars);
      expect(mapped[0].name).toBe('PORT');
      expect(mapped[0].file).toBe('.env.example');
      expect(mapped[0].source).toBe('.env.example');
      expect(mapped[0].line).toBe(2);
      expect(mapped[0].value).toBeUndefined();
    });

    test('mapFacts integrates API endpoints and env vars with file mappings', () => {
      const rawFacts = {
        codeFacts: {
          apiEndpoints: [{ method: 'POST', path: '/auth', source: 'src/auth.js', line: 5 }],
          environmentVariables: [{ name: 'JWT_SECRET', source: 'src/auth.js', line: 1 }],
          dependencies: [{ name: 'bcryptjs', version: '^2.4.3', section: 'dependencies' }],
          scripts: [{ name: 'start', command: 'node server.js' }],
        },
        documentationFacts: {
          apiEndpoints: [{ method: 'POST', path: '/auth', source: 'README.md', line: 50 }],
          environmentVariables: [{ name: 'JWT_SECRET', source: 'README.md', line: 15 }],
        },
      };
      const mapped = mapFacts(rawFacts);
      expect(mapped.code.apiEndpoints[0].file).toBe('src/auth.js');
      expect(mapped.code.envVars[0].file).toBe('src/auth.js');
      expect(mapped.code.dependencies[0].type).toBe('production');
      expect(mapped.code.scripts[0].name).toBe('start');
      expect(mapped.documentation.apiEndpoints[0].file).toBe('README.md');
      expect(mapped.documentation.envVars[0].file).toBe('README.md');
    });
  });

  describe('Group 4: Existing Analysis Record Compatibility', () => {
    test('AnalysisResult validates legacy records without source or flags', () => {
      const doc = new AnalysisResult({
        scanId: new mongoose.Types.ObjectId(),
        repositoryId: new mongoose.Types.ObjectId(),
        userId: new mongoose.Types.ObjectId(),
        analyzerVersion: '1.0.0',
        facts: {
          code: {
            apiEndpoints: [{ method: 'GET', path: '/test', file: 'test.js', line: 1 }],
            envVars: [{ name: 'PORT', file: '.env.example', line: 1 }],
          },
        },
        drift: {
          summary: { total: 0, high: 0, medium: 0, low: 0 },
          findings: [],
        },
      });

      const err = doc.validateSync();
      expect(err).toBeUndefined();
      expect(doc.facts.code.apiEndpoints[0].file).toBe('test.js');
      expect(doc.facts.code.apiEndpoints[0].source).toBeNull();
    });
  });
});

