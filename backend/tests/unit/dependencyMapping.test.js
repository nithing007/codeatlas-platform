/**
 * Unit Tests: Dependency Mapping and Persistence Regression Suite
 * Migrated from backend/scratch/test_dependency_mapping.js.
 * Preserves all 43 original assertions with exact 1:1 test counts.
 */

const mongoose = require('mongoose');
const AnalysisResult = require('../../src/models/AnalysisResult');
const {
  mapDependencies,
  mapScripts,
  mapFacts,
  mapFileCounts,
} = require('../../src/services/scanExecutionService');

describe('Phase 5B.3.1 — Dependency Mapping and Persistence Regression Suite', () => {
  describe('Group 1: Section-to-Type Mapping', () => {
    // 1-4. dependencies → production
    const prodResult = mapDependencies([
      { type: 'DEPENDENCY', name: 'express', version: '^4.17.1', section: 'dependencies' },
    ]);
    test('1. dependencies section maps 1 item', () => {
      expect(prodResult.length).toBe(1);
    });
    test('2. dependencies maps to type "production"', () => {
      expect(prodResult[0].type).toBe('production');
    });
    test('3. name is preserved', () => {
      expect(prodResult[0].name).toBe('express');
    });
    test('4. version is preserved', () => {
      expect(prodResult[0].version).toBe('^4.17.1');
    });

    // 5-8. devDependencies → development
    const devResult = mapDependencies([
      { type: 'DEPENDENCY', name: 'jest', version: '^27.0.0', section: 'devDependencies' },
    ]);
    test('5. devDependencies section maps 1 item', () => {
      expect(devResult.length).toBe(1);
    });
    test('6. devDependencies maps to type "development"', () => {
      expect(devResult[0].type).toBe('development');
    });
    test('7. dev name is preserved', () => {
      expect(devResult[0].name).toBe('jest');
    });
    test('8. dev version is preserved', () => {
      expect(devResult[0].version).toBe('^27.0.0');
    });

    // 9-10. peerDependencies → peer
    const peerResult = mapDependencies([
      { type: 'DEPENDENCY', name: 'react', version: '>=16.8.0', section: 'peerDependencies' },
    ]);
    test('9. peerDependencies section maps 1 item', () => {
      expect(peerResult.length).toBe(1);
    });
    test('10. peerDependencies maps to type "peer"', () => {
      expect(peerResult[0].type).toBe('peer');
    });

    // 11-12. optionalDependencies → optional
    const optResult = mapDependencies([
      { type: 'DEPENDENCY', name: 'fsevents', version: '^2.3.2', section: 'optionalDependencies' },
    ]);
    test('11. optionalDependencies section maps 1 item', () => {
      expect(optResult.length).toBe(1);
    });
    test('12. optionalDependencies maps to type "optional"', () => {
      expect(optResult[0].type).toBe('optional');
    });

    // 13-14. missing section → unknown
    const missingResult = mapDependencies([
      { type: 'DEPENDENCY', name: 'some-pkg', version: '1.0.0' },
    ]);
    test('13. missing section maps 1 item', () => {
      expect(missingResult.length).toBe(1);
    });
    test('14. missing section maps to type "unknown"', () => {
      expect(missingResult[0].type).toBe('unknown');
    });

    // 15-16. unrecognized section → unknown
    const unrecResult = mapDependencies([
      { type: 'DEPENDENCY', name: 'bundled-pkg', version: '1.0.0', section: 'bundledDependencies' },
    ]);
    test('15. unrecognized section maps 1 item', () => {
      expect(unrecResult.length).toBe(1);
    });
    test('16. unrecognized section maps to type "unknown"', () => {
      expect(unrecResult[0].type).toBe('unknown');
    });

    // 17. Analyzer 'DEPENDENCY' fact type is never passed into schema type
    test("17. Analyzer 'DEPENDENCY' fact type is never passed into schema type", () => {
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
      expect(hasDependencyType).toBe(false);
    });

    // 18. missing version defaults to null
    test('18. missing version defaults to null', () => {
      const noVersionResult = mapDependencies([
        { type: 'DEPENDENCY', name: 'no-ver-pkg', section: 'dependencies' },
      ]);
      expect(noVersionResult[0].version).toBeNull();
    });

    // 19. null dependencies returns empty array
    test('19. null dependencies returns empty array', () => {
      expect(mapDependencies(null)).toEqual([]);
    });

    // 20. undefined dependencies returns empty array
    test('20. undefined dependencies returns empty array', () => {
      expect(mapDependencies(undefined)).toEqual([]);
    });

    // 21. string dependencies returns empty array
    test('21. string dependencies returns empty array', () => {
      expect(mapDependencies('not-an-array')).toEqual([]);
    });

    // 22. empty name filtered out
    test('22. empty name filtered out', () => {
      expect(mapDependencies([{ type: 'DEPENDENCY', name: '' }])).toEqual([]);
    });

    // 23-26. Script mapping
    const scriptResult = mapScripts([
      { type: 'SCRIPT', name: 'start', command: 'node server.js', source: 'package.json' },
      { type: 'SCRIPT', name: 'test', command: 'jest' },
      { type: 'SCRIPT', name: 'build' },
    ]);
    test('23. scripts mapped successfully', () => {
      expect(scriptResult.length).toBe(3);
    });
    test('24. script name and command preserved', () => {
      expect(scriptResult[0].name).toBe('start');
      expect(scriptResult[0].command).toBe('node server.js');
    });
    test('25. script extra metadata stripped', () => {
      expect(scriptResult[0].source).toBeUndefined();
      expect(scriptResult[0].type).toBeUndefined();
    });
    test('26. script missing command defaults to null', () => {
      expect(scriptResult[2].command).toBeNull();
    });
  });

  describe('Group 2: Full AnalysisResult Mongoose Validation', () => {
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

    test('27. AnalysisResult passes Mongoose validation with mapped facts', () => {
      const validationError = testDoc.validateSync();
      expect(validationError).toBeUndefined();
    });

    test('28. All 11 dependencies preserved in document', () => {
      expect(testDoc.facts.code.dependencies.length).toBe(11);
    });

    test('29. bcryptjs correctly mapped to type "production"', () => {
      const bcryptDep = testDoc.facts.code.dependencies.find((d) => d.name === 'bcryptjs');
      expect(bcryptDep).toBeDefined();
      expect(bcryptDep.type).toBe('production');
      expect(bcryptDep.version).toBe('^2.4.3');
    });

    test('30. jest correctly mapped to type "development"', () => {
      const jestDep = testDoc.facts.code.dependencies.find((d) => d.name === 'jest');
      expect(jestDep).toBeDefined();
      expect(jestDep.type).toBe('development');
      expect(jestDep.version).toBe('^27.0.6');
    });

    test('31. custom-peer correctly mapped to type "peer"', () => {
      const peerDep = testDoc.facts.code.dependencies.find((d) => d.name === 'custom-peer');
      expect(peerDep).toBeDefined();
      expect(peerDep.type).toBe('peer');
    });

    test('32. custom-opt correctly mapped to type "optional"', () => {
      const optDep = testDoc.facts.code.dependencies.find((d) => d.name === 'custom-opt');
      expect(optDep).toBeDefined();
      expect(optDep.type).toBe('optional');
    });

    test('33. unknown section correctly mapped to type "unknown"', () => {
      const unkDep = testDoc.facts.code.dependencies.find((d) => d.name === 'unknown-section-pkg');
      expect(unkDep).toBeDefined();
      expect(unkDep.type).toBe('unknown');
    });

    describe('Group 3: Security & Structural Contracts', () => {
      const codeEnvVars = testDoc.facts.code.envVars;
      const docEnvVars = testDoc.facts.documentation.envVars;
      const allEnvVars = [...codeEnvVars, ...docEnvVars];

      test('34. Environment variable values and secrets are stripped', () => {
        const hasEnvValues = allEnvVars.some((ev) => ev.value !== undefined || ev.secret !== undefined);
        expect(hasEnvValues).toBe(false);
      });

      test('35. All env vars have names', () => {
        expect(allEnvVars.every((ev) => typeof ev.name === 'string')).toBe(true);
      });

      test('36. Raw files[] array is NOT in AnalysisResult schema', () => {
        const docObj = testDoc.toObject();
        expect(docObj.files).toBeUndefined();
      });

      test('37. fileCounts.total matches statistics (78)', () => {
        expect(testDoc.fileCounts.total).toBe(78);
      });

      test('38. fileCounts.source matches statistics (49)', () => {
        expect(testDoc.fileCounts.source).toBe(49);
      });

      test('39. fileCounts.documentation matches statistics (5)', () => {
        expect(testDoc.fileCounts.documentation).toBe(5);
      });

      test('40. importantFiles preserved', () => {
        expect(testDoc.importantFiles.readme.exists).toBe(true);
      });

      test('41. warnings array preserved', () => {
        expect(testDoc.warnings.length).toBe(1);
        expect(testDoc.warnings[0]).toBe('Some non-fatal warning');
      });
    });

    describe('Group 4: Safe Rejection of Invalid Data', () => {
      test('42. Missing scanId is rejected', () => {
        const missingScanIdDoc = new AnalysisResult({
          repositoryId: new mongoose.Types.ObjectId(),
          userId: new mongoose.Types.ObjectId(),
          analyzerVersion: '1.0.0',
        });
        const missingScanIdErr = missingScanIdDoc.validateSync();
        expect(missingScanIdErr).toBeDefined();
        expect(missingScanIdErr.errors['scanId']).toBeDefined();
      });

      test('43. Invalid finding severity is rejected', () => {
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
        expect(invalidSevErr).toBeDefined();
        expect(invalidSevErr.errors['drift.findings.0.severity']).toBeDefined();
      });
    });
  });
});
