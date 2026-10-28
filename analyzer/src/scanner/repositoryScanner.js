/**
 * Repository Scanner
 * Orchestrates tree retrieval, path sanitization, file inventory generation,
 * categorization, important file detection, metrics compilation,
 * and code/documentation fact extraction.
 */

const path = require('path');
const { sanitizePath, isExcludedSecretFile, ALLOWED_ENV_TEMPLATES } = require('../utils/pathSecurity');
const { isBinaryExtension } = require('../utils/binaryDetector');
const { classifyFile, CATEGORIES } = require('./fileClassifier');
const { detectImportantFiles } = require('./importantFileDetector');
const { extractApiEndpoints, resolvePrefixes } = require('../extractors/apiExtractor');
const { extractEnvVarsFromSource, extractEnvVarsFromTemplate } = require('../extractors/envExtractor');
const { extractFromPackageJson } = require('../extractors/dependencyExtractor');
const { extractFromDocumentation } = require('../extractors/documentationExtractor');
const { extractFromOpenApi } = require('../extractors/openApiExtractor');
const { extractModuleGraph } = require('../extractors/moduleGraphExtractor');
const { resolveWithModuleGraph } = require('../extractors/crossFileResolver');
const { detectDrift } = require('../drift/driftDetector');
const config = require('../config');

// Source file extensions eligible for API and env var extraction
const JS_TS_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts']);

// Documentation file extensions
const DOC_EXTENSIONS = new Set(['.md', '.mdx', '.markdown', '.rst', '.txt']);

// OpenAPI/Swagger filename patterns
const OPENAPI_FILENAMES = new Set([
  'openapi.json', 'openapi.yaml', 'openapi.yml',
  'swagger.json', 'swagger.yaml', 'swagger.yml',
]);
const OPENAPI_FILENAME_RE = /(?:openapi|swagger)(?:[-_][\w]+)?\.(?:json|ya?ml)$/i;

// Issue 3 fix: Top-level directory segments that identify test code.
// Files under these directories are kept in the inventory/statistics but
// are excluded from production API endpoint fact extraction.
// Matching is done on the POSIX-normalized path prefix so it is OS-independent.
const TEST_DIR_SEGMENTS = new Set(['tests', 'test', '__tests__', 'spec', '__spec__', 'e2e']);

/**
 * Returns true if the file path is inside a recognised test directory.
 * Only checks the first path segment that matches — production dirs like
 * src/testHelpers or lib/testing-utils are NOT excluded.
 *
 * @param {string} filePath - POSIX-normalized repository-relative path.
 * @returns {boolean}
 */
function isTestFile(filePath) {
  // Normalize to forward slashes for cross-platform safety
  const normalized = filePath.replace(/\\/g, '/');
  const segments = normalized.split('/');
  // Check whether any path segment (not just the filename) is a recognised
  // test directory. We only exclude if the *directory name* matches exactly —
  // a file named 'tests.js' at the root level is NOT excluded.
  for (let i = 0; i < segments.length - 1; i++) {
    if (TEST_DIR_SEGMENTS.has(segments[i].toLowerCase())) return true;
  }
  return false;
}

// Issue 4 fix: System/runtime environment variables that are always available
// and should not generate drift findings. Kept intentionally small — only
// variables that are genuinely provided by the OS/runtime, not by the app.
const SYSTEM_ENV_SKIP_SET = new Set([
  'NODE_ENV', 'PATH', 'HOME', 'PWD', 'SHELL', 'USER', 'TMPDIR', 'TEMP', 'TMP',
  'LANG', 'TERM', 'EDITOR', 'PAGER', 'LOGNAME', 'HOSTNAME', 'DISPLAY',
]);

class RepositoryScanner {
  /**
   * @param {import('../providers/repositoryProvider')} provider - Repository data provider instance.
   * @param {Object} [options={}] - Custom configuration overrides.
   */
  constructor(provider, options = {}) {
    if (!provider) {
      throw new Error('RepositoryScanner requires a valid RepositoryProvider.');
    }
    this.provider = provider;
    this.maxFileSizeBytes = options.maxFileSizeBytes || config.maxFileSizeBytes;
    this.maxTotalFiles = options.maxTotalFiles || config.maxTotalFiles;
  }

  /**
   * Performs static scan and produces structured repository inventory, metadata, and extracted facts.
   *
   * @param {string} owner - Repository owner.
   * @param {string} repo - Repository name.
   * @param {string} [branch='main'] - Target branch or ref.
   * @returns {Promise<Object>} Structured analysis result including facts.
   */
  async scan(owner, repo, branch = 'main') {
    // 1. Fetch complete repository tree from provider
    const treeResult = await this.provider.getTree(owner, repo, branch);
    const rawFiles = treeResult.tree || [];

    const files = [];
    const statistics = {
      totalFiles: 0,
      sourceFiles: 0,
      documentationFiles: 0,
      configurationFiles: 0,
      infrastructureFiles: 0,
      buildFiles: 0,
      unknownFiles: 0,
      skippedBinaryFiles: 0,
      skippedOversizedFiles: 0,
      excludedSecretFiles: 0,
    };

    // 2. Process each file safely — build inventory
    for (const rawFile of rawFiles) {
      if (files.length >= this.maxTotalFiles) {
        break;
      }

      let sanitizedPath;
      try {
        sanitizedPath = sanitizePath(rawFile.path);
      } catch {
        // Skip malformed/dangerous paths silently
        continue;
      }

      const fileName = path.basename(sanitizedPath);
      const extension = path.extname(sanitizedPath).toLowerCase();
      const fileSize = typeof rawFile.size === 'number' ? rawFile.size : 0;

      // Security: exclude actual .env secret files entirely
      const isSecret = isExcludedSecretFile(sanitizedPath);
      if (isSecret) {
        statistics.excludedSecretFiles++;
        continue;
      }

      const isBinary = isBinaryExtension(sanitizedPath);
      const isOversized = fileSize > this.maxFileSizeBytes;

      if (isBinary) statistics.skippedBinaryFiles++;
      if (isOversized) statistics.skippedOversizedFiles++;

      const category = classifyFile(sanitizedPath);

      statistics.totalFiles++;
      switch (category) {
        case CATEGORIES.SOURCE:         statistics.sourceFiles++;          break;
        case CATEGORIES.DOCUMENTATION:  statistics.documentationFiles++;   break;
        case CATEGORIES.CONFIGURATION:  statistics.configurationFiles++;   break;
        case CATEGORIES.INFRASTRUCTURE: statistics.infrastructureFiles++;  break;
        case CATEGORIES.BUILD:          statistics.buildFiles++;           break;
        default:                        statistics.unknownFiles++;          break;
      }

      files.push({
        path: sanitizedPath,
        name: fileName,
        extension,
        category,
        size: fileSize,
        isBinary,
        isOversized,
        sha: rawFile.sha || null,
      });
    }

    // 3. Detect important files across inventory
    const importantFiles = detectImportantFiles(files);

    // 4. Extract facts from file contents
    const facts = await this._extractFacts(owner, repo, branch, files, importantFiles);

    // 5. Run deterministic drift detection over extracted facts
    const drift = detectDrift(facts);

    // 6. Return structured analysis result
    return {
      repository: {
        owner,
        name: repo,
        fullName: `${owner}/${repo}`,
        branch,
        commitSha: treeResult.commitSha || null,
      },
      statistics,
      files,
      importantFiles,
      facts,
      drift,
    };
  }

  /**
   * Orchestrates fact extraction across all eligible files.
   * Fetches file contents from the provider on demand.
   *
   * @private
   */
  async _extractFacts(owner, repo, branch, files, importantFiles) {
    const codeFacts = {
      apiEndpoints: [],
      environmentVariables: [],
      dependencies: [],
      scripts: [],
    };
    const documentationFacts = {
      apiEndpoints: [],
      environmentVariables: [],
    };
    const warnings = [];

    // Accumulate all endpoints and mounts across source files for prefix resolution
    const allEndpoints = [];
    const allMountedPrefixes = [];

    // Cross-file module graph accumulators
    // fileRequiresMap: filePath → Map<varName, relativePath>
    // fileExportsMap:  filePath → exportedVarName
    const fileRequiresMap = new Map();
    const fileExportsMap  = new Map();

    for (const file of files) {
      // Skip files that cannot be usefully processed as text
      if (file.isBinary || file.isOversized) continue;

      const filePath = file.path;
      const ext = file.extension;
      const fileName = file.name.toLowerCase();

      // Determine which extractors to run
      const isJsTs = JS_TS_EXTENSIONS.has(ext);
      const isDocFile = DOC_EXTENSIONS.has(ext) || file.category === CATEGORIES.DOCUMENTATION;
      const isPackageJson = fileName === 'package.json';
      const isEnvTemplate = ALLOWED_ENV_TEMPLATES.has(fileName);
      const isOpenApi = OPENAPI_FILENAMES.has(fileName) || OPENAPI_FILENAME_RE.test(fileName);

      // Skip if none of our extractors apply
      if (!isJsTs && !isDocFile && !isPackageJson && !isEnvTemplate && !isOpenApi) {
        continue;
      }

      // Fetch file content from provider
      let content;
      try {
        const result = await this.provider.getFileContent(owner, repo, filePath, branch);
        content = result.content;
      } catch (err) {
        warnings.push(`[scanner] Could not fetch ${filePath}: ${err.message}`);
        continue;
      }

      if (!content) continue;

      // --- JS/TS: API endpoints and env vars ---
      if (isJsTs) {
        try {
          // Issue 3 fix: Only extract API route facts from production source files.
          if (!isTestFile(filePath)) {
            const { endpoints, mountedPrefixes } = extractApiEndpoints(content, filePath);
            allEndpoints.push(...endpoints);
            allMountedPrefixes.push(...mountedPrefixes);

            // Cross-file module graph: extract require/import and export info
            const { requires, exportedVar } = extractModuleGraph(content, filePath);
            if (requires.size > 0) fileRequiresMap.set(filePath, requires);
            if (exportedVar)       fileExportsMap.set(filePath, exportedVar);
          }

          // Env var extraction runs on all JS/TS
          const envVars = extractEnvVarsFromSource(content, filePath);
          codeFacts.environmentVariables.push(...envVars);
        } catch (err) {
          warnings.push(`[apiExtractor] Error in ${filePath}: ${err.message}`);
        }
      }

      // --- package.json: dependencies and scripts ---
      if (isPackageJson) {
        try {
          const { dependencies, scripts, warnings: pkgWarnings } = extractFromPackageJson(content, filePath);
          codeFacts.dependencies.push(...dependencies);
          codeFacts.scripts.push(...scripts);
          warnings.push(...pkgWarnings);
        } catch (err) {
          warnings.push(`[dependencyExtractor] Error in ${filePath}: ${err.message}`);
        }
      }

      // --- .env.example: documented env vars ---
      if (isEnvTemplate) {
        try {
          const envVars = extractEnvVarsFromTemplate(content, filePath);
          // Template vars go into codeFacts as they describe the application contract
          codeFacts.environmentVariables.push(...envVars);
        } catch (err) {
          warnings.push(`[envExtractor] Error in ${filePath}: ${err.message}`);
        }
      }

      // --- Markdown / Documentation files ---
      if (isDocFile && !isOpenApi) {
        try {
          const { apiEndpoints, environmentVariables, warnings: docWarnings } =
            extractFromDocumentation(content, filePath);
          documentationFacts.apiEndpoints.push(...apiEndpoints);
          documentationFacts.environmentVariables.push(...environmentVariables);
          warnings.push(...docWarnings);
        } catch (err) {
          warnings.push(`[documentationExtractor] Error in ${filePath}: ${err.message}`);
        }
      }

      // --- OpenAPI/Swagger files ---
      if (isOpenApi) {
        try {
          const { apiEndpoints, warnings: oaWarnings } = extractFromOpenApi(content, filePath);
          codeFacts.apiEndpoints.push(...apiEndpoints);
          warnings.push(...oaWarnings);
        } catch (err) {
          warnings.push(`[openApiExtractor] Error in ${filePath}: ${err.message}`);
        }
      }
    }

    // ── Prefix resolution ──────────────────────────────────────────────────
    // Pass 1: single-file resolution (same-file app.use mounts)
    const singleFileResolved = resolvePrefixes(allEndpoints, allMountedPrefixes);

    // Pass 2: cross-file resolution (require() → module.exports chains)
    const filePathSet = new Set(files.map(f => f.path));
    const fullyResolved = resolveWithModuleGraph(
      singleFileResolved,
      allMountedPrefixes,
      fileRequiresMap,
      fileExportsMap,
      filePathSet
    );

    codeFacts.apiEndpoints.push(...fullyResolved);

    // Deduplicate env vars within code facts (keep first occurrence per name)
    // Issue 4 fix: also remove system/runtime variables that are always available
    // and would produce low-signal drift findings (e.g. NODE_ENV, PATH, HOME).
    codeFacts.environmentVariables = deduplicateFacts(
      codeFacts.environmentVariables.filter(ev => !SYSTEM_ENV_SKIP_SET.has(ev.name)),
      'name'
    );

    // Also remove system vars from documentation facts (defensive — documentationExtractor
    // already skips them, but belt-and-suspenders for any future extractor additions).
    documentationFacts.environmentVariables = deduplicateFacts(
      documentationFacts.environmentVariables.filter(ev => !SYSTEM_ENV_SKIP_SET.has(ev.name)),
      'name'
    );

    return {
      codeFacts,
      documentationFacts,
      warnings,
    };
  }
}

// ---- Helpers ----

/**
 * Deduplicates an array of fact objects by a key field, preserving first occurrence.
 */
function deduplicateFacts(facts, keyField) {
  const seen = new Set();
  return facts.filter((fact) => {
    const k = fact[keyField];
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

module.exports = RepositoryScanner;
