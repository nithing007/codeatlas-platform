/**
 * CodeAtlas Analyzer Engine — Test Suite
 * Covers repository access, file inventory, classification, important file detection,
 * security sanitization, binary detection, size limits, and structured output.
 */

const {
  RepositoryScanner,
  GitHubRepositoryProvider,
  MockRepositoryProvider,
  classifyFile,
  CATEGORIES,
  detectImportantFiles,
  sanitizePath,
  isExcludedSecretFile,
  isBinaryExtension,
  isBinaryContent,
} = require('../src/index');

async function runAnalyzerTests() {
  console.log('\n======================================================');
  console.log('  Phase 4A Analyzer Engine Foundation Test Suite');
  console.log('======================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition, message) {
    total++;
    if (!condition) {
      console.error(`❌ FAILED: ${message}`);
      throw new Error(message);
    }
    passed++;
    console.log(`  ✅ ${message}`);
  }

  // -------------------------------------------------------------
  // Test Group 1: Path Security & Traversal Protection
  // -------------------------------------------------------------
  console.log('--- Test Group 1: Path Security & Traversal Protection ---');

  assert(sanitizePath('src/controllers/auth.js') === 'src/controllers/auth.js', 'Normal path is sanitized properly');
  assert(sanitizePath('\\src\\routes\\index.js') === 'src/routes/index.js', 'Windows backslashes normalized to POSIX slashes');
  assert(sanitizePath('./backend/package.json') === 'backend/package.json', 'Leading dot-slash stripped safely');

  let traversalBlocked = false;
  try {
    sanitizePath('../../etc/passwd');
  } catch (err) {
    traversalBlocked = true;
  }
  assert(traversalBlocked, 'Directory traversal (../../) is blocked with an error');

  let nullByteBlocked = false;
  try {
    sanitizePath('safe/path\0/malicious.js');
  } catch (err) {
    nullByteBlocked = true;
  }
  assert(nullByteBlocked, 'Null byte injection is rejected with an error');

  // -------------------------------------------------------------
  // Test Group 2: Actual .env Secret Exclusion
  // -------------------------------------------------------------
  console.log('\n--- Test Group 2: .env Secret File Exclusion ---');

  assert(isExcludedSecretFile('.env') === true, 'Actual .env file is identified as an excluded secret');
  assert(isExcludedSecretFile('.env.local') === true, '.env.local is identified as an excluded secret');
  assert(isExcludedSecretFile('.env.production') === true, '.env.production is identified as an excluded secret');
  assert(isExcludedSecretFile('config/.env.secret') === true, 'Nested .env.secret is identified as an excluded secret');

  assert(isExcludedSecretFile('.env.example') === false, '.env.example is PERMITTED for documentation analysis');
  assert(isExcludedSecretFile('.env.sample') === false, '.env.sample is PERMITTED for documentation analysis');
  assert(isExcludedSecretFile('.env.template') === false, '.env.template is PERMITTED for documentation analysis');

  // -------------------------------------------------------------
  // Test Group 3: Binary File Detection
  // -------------------------------------------------------------
  console.log('\n--- Test Group 3: Binary File Detection ---');

  assert(isBinaryExtension('assets/logo.png') === true, 'PNG image identified as binary');
  assert(isBinaryExtension('bin/server.exe') === true, 'EXE binary identified as binary');
  assert(isBinaryExtension('archive.tar.gz') === true, 'TAR.GZ archive identified as binary');
  assert(isBinaryExtension('fonts/roboto.woff2') === true, 'WOFF2 font identified as binary');
  assert(isBinaryExtension('src/app.js') === false, 'JavaScript source file identified as text');
  assert(isBinaryExtension('README.md') === false, 'Markdown file identified as text');

  assert(isBinaryContent(Buffer.from([0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x77])) === true, 'Buffer containing null bytes identified as binary');
  assert(isBinaryContent(Buffer.from('Hello World, this is clean utf-8 text')) === false, 'Buffer with clean text identified as non-binary');

  // -------------------------------------------------------------
  // Test Group 4: File Semantic Classification
  // -------------------------------------------------------------
  console.log('\n--- Test Group 4: File Semantic Classification ---');

  assert(classifyFile('src/routes/authRoutes.js') === CATEGORIES.SOURCE, 'JS file classified as SOURCE');
  assert(classifyFile('frontend/App.tsx') === CATEGORIES.SOURCE, 'TSX file classified as SOURCE');
  assert(classifyFile('backend/main.py') === CATEGORIES.SOURCE, 'Python file classified as SOURCE');
  assert(classifyFile('server.go') === CATEGORIES.SOURCE, 'Go file classified as SOURCE');

  assert(classifyFile('README.md') === CATEGORIES.DOCUMENTATION, 'README.md classified as DOCUMENTATION');
  assert(classifyFile('docs/architecture.rst') === CATEGORIES.DOCUMENTATION, 'RST file classified as DOCUMENTATION');
  assert(classifyFile('docs/api/guide.mdx') === CATEGORIES.DOCUMENTATION, 'MDX file classified as DOCUMENTATION');

  assert(classifyFile('package.json') === CATEGORIES.CONFIGURATION, 'package.json classified as CONFIGURATION');
  assert(classifyFile('tsconfig.json') === CATEGORIES.CONFIGURATION, 'tsconfig.json classified as CONFIGURATION');
  assert(classifyFile('.env.example') === CATEGORIES.CONFIGURATION, '.env.example classified as CONFIGURATION');
  assert(classifyFile('vite.config.js') === CATEGORIES.CONFIGURATION, 'vite.config.js classified as CONFIGURATION');

  assert(classifyFile('Dockerfile') === CATEGORIES.INFRASTRUCTURE, 'Dockerfile classified as INFRASTRUCTURE');
  assert(classifyFile('docker-compose.yml') === CATEGORIES.INFRASTRUCTURE, 'docker-compose.yml classified as INFRASTRUCTURE');
  assert(classifyFile('k8s/deployment.yaml') === CATEGORIES.INFRASTRUCTURE, 'k8s/deployment.yaml classified as INFRASTRUCTURE');
  assert(classifyFile('.github/workflows/ci.yml') === CATEGORIES.INFRASTRUCTURE, 'GitHub Actions workflow classified as INFRASTRUCTURE');

  assert(classifyFile('Makefile') === CATEGORIES.BUILD, 'Makefile classified as BUILD');
  assert(classifyFile('CMakeLists.txt') === CATEGORIES.BUILD, 'CMakeLists.txt classified as BUILD');

  // -------------------------------------------------------------
  // Test Group 5: Important File Detection
  // -------------------------------------------------------------
  console.log('\n--- Test Group 5: Important File Detection ---');

  const testFileList = [
    { path: 'README.md' },
    { path: 'docs/README.md' },
    { path: '.env.example' },
    { path: 'package.json' },
    { path: 'openapi.yaml' },
    { path: 'docs/swagger.json' },
    { path: 'Dockerfile' },
    { path: 'docker-compose.yml' },
    { path: 'k8s/service.yaml' },
    { path: 'src/index.js' },
  ];

  const detected = detectImportantFiles(testFileList);

  assert(detected.readme.includes('README.md') && detected.readme.includes('docs/README.md'), 'README files detected');
  assert(detected.environment.includes('.env.example'), '.env.example detected');
  assert(detected.packageManifests.includes('package.json'), 'package.json detected');
  assert(detected.apiSpecifications.includes('openapi.yaml') && detected.apiSpecifications.includes('docs/swagger.json'), 'OpenAPI/Swagger specs detected');
  assert(detected.docker.includes('Dockerfile') && detected.docker.includes('docker-compose.yml'), 'Docker files detected');
  assert(detected.kubernetes.includes('k8s/service.yaml'), 'Kubernetes files detected');

  // -------------------------------------------------------------
  // Test Group 6: Full Repository Scan (Mock Provider Fixture)
  // -------------------------------------------------------------
  console.log('\n--- Test Group 6: Full Repository Scan on Fixture Repository ---');

  const mockProvider = new MockRepositoryProvider();

  mockProvider.addRepository('testowner', 'testrepo', {
    commitSha: 'a1b2c3d4e5f67890abcdef1234567890abcdef12',
    files: {
      'README.md': '# Test Project\nDocumentation here.',
      '.env.example': 'PORT=5000\nNODE_ENV=development',
      '.env': 'PORT=5000\nSECRET_KEY=super_secret_never_leak_this', // Actual secret file! Must be excluded
      'package.json': '{\n  "name": "test-repo",\n  "version": "1.0.0"\n}',
      'src/server.js': 'const express = require("express");\nconst app = express();',
      'src/routes/api.js': 'router.get("/users", handler);',
      'docs/openapi.yaml': 'openapi: "3.0.0"\ninfo:\n  title: Test API',
      'Dockerfile': 'FROM node:20-alpine\nWORKDIR /app',
      'k8s/deployment.yaml': 'apiVersion: apps/v1\nkind: Deployment',
      'Makefile': 'test:\n\tnpm test',
      'assets/logo.png': { size: 15420 }, // Binary
      'data/huge-dataset.csv': { size: 10 * 1024 * 1024 }, // 10MB -> Oversized!
    },
  });

  const scanner = new RepositoryScanner(mockProvider, { maxFileSizeBytes: 512 * 1024 });
  const result = await scanner.scan('testowner', 'testrepo', 'main');

  console.log('\n  Scan Result Summary:');
  console.log(`    Repository: ${result.repository.fullName} (${result.repository.commitSha.substring(0, 10)}...)`);
  console.log(`    Total Files in Inventory: ${result.statistics.totalFiles}`);
  console.log(`    Source Files: ${result.statistics.sourceFiles}`);
  console.log(`    Doc Files: ${result.statistics.documentationFiles}`);
  console.log(`    Config Files: ${result.statistics.configurationFiles}`);
  console.log(`    Infra Files: ${result.statistics.infrastructureFiles}`);
  console.log(`    Build Files: ${result.statistics.buildFiles}`);
  console.log(`    Skipped Binary: ${result.statistics.skippedBinaryFiles}`);
  console.log(`    Skipped Oversized: ${result.statistics.skippedOversizedFiles}`);
  console.log(`    Excluded Secrets: ${result.statistics.excludedSecretFiles}`);

  assert(result.repository.fullName === 'testowner/testrepo', 'Repository full name matches');
  assert(result.repository.commitSha === 'a1b2c3d4e5f67890abcdef1234567890abcdef12', 'Commit SHA preserved');
  assert(result.statistics.sourceFiles === 2, '2 source files identified (server.js, api.js)');
  assert(result.statistics.documentationFiles === 1, '1 documentation file identified (README.md)');
  assert(result.statistics.configurationFiles === 3, '3 configuration files identified (package.json, .env.example, docs/openapi.yaml)');
  assert(result.statistics.infrastructureFiles === 2, '2 infrastructure files identified (Dockerfile, k8s/deployment.yaml)');
  assert(result.statistics.buildFiles === 1, '1 build file identified (Makefile)');
  assert(result.statistics.skippedBinaryFiles === 1, '1 binary file identified and marked (logo.png)');
  assert(result.statistics.skippedOversizedFiles === 1, '1 oversized file identified and marked (huge-dataset.csv)');
  assert(result.statistics.excludedSecretFiles === 1, '1 real .env file excluded completely from inventory');

  // Verify .env was not included in file list
  const envIncluded = result.files.some((f) => f.path === '.env');
  assert(!envIncluded, 'Security verification: Real .env file is NOT present in files inventory');

  // Verify importantFiles mapping
  assert(result.importantFiles.readme[0] === 'README.md', 'Important files: README found');
  assert(result.importantFiles.environment[0] === '.env.example', 'Important files: .env.example found');
  assert(result.importantFiles.packageManifests[0] === 'package.json', 'Important files: package.json found');
  assert(result.importantFiles.apiSpecifications[0] === 'docs/openapi.yaml', 'Important files: openapi.yaml found');
  assert(result.importantFiles.docker[0] === 'Dockerfile', 'Important files: Dockerfile found');
  assert(result.importantFiles.kubernetes[0] === 'k8s/deployment.yaml', 'Important files: k8s deployment found');

  // -------------------------------------------------------------
  // Test Group 7: Non-Existent Repository Handling
  // -------------------------------------------------------------
  console.log('\n--- Test Group 7: Error Handling (Non-existent Repository) ---');

  let notFoundHandled = false;
  try {
    await scanner.scan('nonexistent', 'nonexistent', 'main');
  } catch (err) {
    notFoundHandled = true;
    assert(err.statusCode === 404, '404 status code returned for non-existent repository');
  }
  assert(notFoundHandled, 'Non-existent repository handled safely with error');

  // -------------------------------------------------------------
  // Test Group 8: Phase 7D - GitHub API 403 vs 429 Error Classification (Tests A-E)
  // -------------------------------------------------------------
  console.log('\n--- Test Group 8: Phase 7D - GitHub API 403 vs 429 Classification ---');

  function createMockResponse({ status, headers = {}, body = {} }) {
    const headerMap = new Map();
    for (const [k, v] of Object.entries(headers)) {
      headerMap.set(k.toLowerCase(), String(v));
    }
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: {
        get: (name) => headerMap.get(name.toLowerCase()) || null,
      },
      json: async () => body,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
  }

  const provider = new GitHubRepositoryProvider();

  // Test A1: Commit lookup 403 with x-ratelimit-remaining: '0' -> statusCode: 429
  {
    provider._fetch = async () => createMockResponse({
      status: 403,
      headers: { 'x-ratelimit-remaining': '0' },
    });
    let errCaught = null;
    try {
      await provider.getTree('owner', 'repo', 'main');
    } catch (err) {
      errCaught = err;
    }
    assert(errCaught && errCaught.statusCode === 429, 'Test A1: Commit 403 with remaining 0 throws statusCode 429');
  }

  // Test A2: Tree lookup 403 with x-ratelimit-remaining: '0' -> statusCode: 429
  {
    let callCount = 0;
    provider._fetch = async () => {
      callCount++;
      if (callCount === 1) {
        return createMockResponse({ status: 200, body: { sha: 'sha123' } });
      }
      return createMockResponse({
        status: 403,
        headers: { 'x-ratelimit-remaining': '0' },
      });
    };
    let errCaught = null;
    try {
      await provider.getTree('owner', 'repo', 'main');
    } catch (err) {
      errCaught = err;
    }
    assert(errCaught && errCaught.statusCode === 429, 'Test A2: Tree 403 with remaining 0 throws statusCode 429');
  }

  // Test A3: File content 403 with x-ratelimit-remaining: '0' -> statusCode: 429
  {
    provider._fetch = async () => createMockResponse({
      status: 403,
      headers: { 'x-ratelimit-remaining': '0' },
    });
    let errCaught = null;
    try {
      await provider.getFileContent('owner', 'repo', 'README.md');
    } catch (err) {
      errCaught = err;
    }
    assert(errCaught && errCaught.statusCode === 429, 'Test A3: File content 403 with remaining 0 throws statusCode 429');
  }

  // Test B1: Commit lookup 403 with x-ratelimit-remaining: '10' -> statusCode: 403
  {
    provider._fetch = async () => createMockResponse({
      status: 403,
      headers: { 'x-ratelimit-remaining': '10' },
    });
    let errCaught = null;
    try {
      await provider.getTree('owner', 'repo', 'main');
    } catch (err) {
      errCaught = err;
    }
    assert(errCaught && errCaught.statusCode === 403, 'Test B1: Commit 403 with remaining >0 throws statusCode 403');
  }

  // Test B2: Tree lookup 403 with x-ratelimit-remaining: '10' -> statusCode: 403
  {
    let callCount = 0;
    provider._fetch = async () => {
      callCount++;
      if (callCount === 1) {
        return createMockResponse({ status: 200, body: { sha: 'sha123' } });
      }
      return createMockResponse({
        status: 403,
        headers: { 'x-ratelimit-remaining': '10' },
      });
    };
    let errCaught = null;
    try {
      await provider.getTree('owner', 'repo', 'main');
    } catch (err) {
      errCaught = err;
    }
    assert(errCaught && errCaught.statusCode === 403, 'Test B2: Tree 403 with remaining >0 throws statusCode 403');
  }

  // Test B3: File content 403 with x-ratelimit-remaining: '10' -> statusCode: 403
  {
    provider._fetch = async () => createMockResponse({
      status: 403,
      headers: { 'x-ratelimit-remaining': '10' },
    });
    let errCaught = null;
    try {
      await provider.getFileContent('owner', 'repo', 'README.md');
    } catch (err) {
      errCaught = err;
    }
    assert(errCaught && errCaught.statusCode === 403, 'Test B3: File content 403 with remaining >0 throws statusCode 403');
  }

  // Test C1: Commit lookup 403 with missing header -> statusCode: 403
  {
    provider._fetch = async () => createMockResponse({ status: 403 });
    let errCaught = null;
    try {
      await provider.getTree('owner', 'repo', 'main');
    } catch (err) {
      errCaught = err;
    }
    assert(errCaught && errCaught.statusCode === 403, 'Test C1: Commit 403 with missing header throws statusCode 403');
  }

  // Test C2: Tree lookup 403 with missing header -> statusCode: 403
  {
    let callCount = 0;
    provider._fetch = async () => {
      callCount++;
      if (callCount === 1) {
        return createMockResponse({ status: 200, body: { sha: 'sha123' } });
      }
      return createMockResponse({ status: 403 });
    };
    let errCaught = null;
    try {
      await provider.getTree('owner', 'repo', 'main');
    } catch (err) {
      errCaught = err;
    }
    assert(errCaught && errCaught.statusCode === 403, 'Test C2: Tree 403 with missing header throws statusCode 403');
  }

  // Test C3: File content 403 with missing header -> statusCode: 403
  {
    provider._fetch = async () => createMockResponse({ status: 403 });
    let errCaught = null;
    try {
      await provider.getFileContent('owner', 'repo', 'README.md');
    } catch (err) {
      errCaught = err;
    }
    assert(errCaught && errCaught.statusCode === 403, 'Test C3: File content 403 with missing header throws statusCode 403');
  }

  // Test D1: Commit 429 -> statusCode: 429
  {
    provider._fetch = async () => createMockResponse({ status: 429 });
    let errCaught = null;
    try {
      await provider.getTree('owner', 'repo', 'main');
    } catch (err) {
      errCaught = err;
    }
    assert(errCaught && errCaught.statusCode === 429, 'Test D1: Commit 429 throws statusCode 429');
  }

  // Test D2: Tree 429 -> statusCode: 429
  {
    let callCount = 0;
    provider._fetch = async () => {
      callCount++;
      if (callCount === 1) {
        return createMockResponse({ status: 200, body: { sha: 'sha123' } });
      }
      return createMockResponse({ status: 429 });
    };
    let errCaught = null;
    try {
      await provider.getTree('owner', 'repo', 'main');
    } catch (err) {
      errCaught = err;
    }
    assert(errCaught && errCaught.statusCode === 429, 'Test D2: Tree 429 throws statusCode 429');
  }

  // Test D3: File content 429 -> statusCode: 429
  {
    provider._fetch = async () => createMockResponse({ status: 429 });
    let errCaught = null;
    try {
      await provider.getFileContent('owner', 'repo', 'README.md');
    } catch (err) {
      errCaught = err;
    }
    assert(errCaught && errCaught.statusCode === 429, 'Test D3: File content 429 throws statusCode 429');
  }

  // Test E1: 404 preservation
  {
    provider._fetch = async () => createMockResponse({ status: 404 });
    let errCaught = null;
    try {
      await provider.getTree('owner', 'repo', 'main');
    } catch (err) {
      errCaught = err;
    }
    assert(errCaught && errCaught.statusCode === 404, 'Test E1a: Commit 404 throws statusCode 404');

    errCaught = null;
    try {
      await provider.getFileContent('owner', 'repo', 'missing.txt');
    } catch (err) {
      errCaught = err;
    }
    assert(errCaught && errCaught.statusCode === 404, 'Test E1b: File 404 throws statusCode 404');
  }

  // Test E2: 504 Timeout preservation
  {
    const timeoutProvider = new GitHubRepositoryProvider({ timeoutMs: 50 });
    timeoutProvider._fetch = async () => {
      const err = new Error('GitHub API request timed out after 50ms.');
      err.statusCode = 504;
      throw err;
    };
    let errCaught = null;
    try {
      await timeoutProvider.getTree('owner', 'repo', 'main');
    } catch (err) {
      errCaught = err;
    }
    assert(errCaught && errCaught.statusCode === 504, 'Test E2: Timeout throws statusCode 504');
  }

  // Test E3: 502 Network Error preservation
  {
    const netProvider = new GitHubRepositoryProvider();
    netProvider._fetch = async () => {
      const err = new Error('GitHub network error: fetch failed');
      err.statusCode = 502;
      throw err;
    };
    let errCaught = null;
    try {
      await netProvider.getTree('owner', 'repo', 'main');
    } catch (err) {
      errCaught = err;
    }
    assert(errCaught && errCaught.statusCode === 502, 'Test E3: Network error throws statusCode 502');
  }

  console.log('\n======================================================');
  console.log(`  ALL ${passed}/${total} ANALYZER ENGINE TESTS PASSED!`);
  console.log('======================================================\n');
}

runAnalyzerTests().catch((err) => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});
