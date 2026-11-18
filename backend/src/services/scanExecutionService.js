/**
 * Scan Execution Service
 *
 * Orchestrates the full repository analysis lifecycle for a single Scan document.
 * Entry point: executeScan(scanId)
 *
 * Lifecycle:
 *   QUEUED → RUNNING → COMPLETED
 *           ↘         ↘
 *            FAILED    FAILED (if AnalysisResult persistence fails)
 *
 * Design contract:
 * - Has NO HTTP concerns (no req/res).
 * - Accepts only a scanId; loads all context from the database.
 * - Uses atomic QUEUED→RUNNING transition to prevent concurrent double-execution.
 * - Never leaks stack traces, tokens, or internal paths into Scan.error.
 * - Does NOT persist the raw files[] inventory (security/structural contract).
 * - Designed so the caller (currently setImmediate in-process) can be replaced
 *   by a real queue worker without changing this service's interface or semantics.
 */

'use strict';

const Scan = require('../models/Scan');
const Repository = require('../models/Repository');
const AnalysisResult = require('../models/AnalysisResult');
const analyzerService = require('./analyzerService');
const { classifyError, sanitizeErrorMessage } = require('../queue/errorClassifier');
const { scheduleRetry, markTerminalFailure } = require('../queue/scanWorker');

// ---------------------------------------------------------------------------
// Analyzer version constant
// ---------------------------------------------------------------------------

/**
 * Semantic version of the current analyzer.
 * Must match the `version` field in analyzer/package.json.
 */
const ANALYZER_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Maps the analyzer's statistics output to the AnalysisResult fileCounts schema.
 *
 * @param {Object} statistics - analyzer result.statistics
 * @returns {Object} fileCounts object
 */
function mapFileCounts(statistics) {
  const total          = statistics.totalFiles          || 0;
  const source         = statistics.sourceFiles         || 0;
  const documentation  = statistics.documentationFiles  || 0;
  const configuration  = statistics.configurationFiles  || 0;
  const infrastructure = statistics.infrastructureFiles || 0;
  const other = Math.max(0, total - source - documentation - configuration - infrastructure);

  return { total, source, documentation, configuration, infrastructure, other };
}

/**
 * Maps an array of environment variable facts to name-only objects.
 * SECURITY: strips any value/secret fields — only name is persisted.
 *
 * @param {Array} envVars - Raw env var facts from analyzer (field: environmentVariables).
 * @returns {Array<{ name: string, file: string|null, line: number|null }>}
 */
function mapEnvVars(envVars) {
  if (!Array.isArray(envVars)) return [];
  return envVars.map((ev) => {
    const filePath = (ev && (ev.file || ev.source)) ? String(ev.file || ev.source).trim() : null;
    return {
      name: ev.name,
      file: filePath,
      source: filePath,
      line: typeof ev.line === 'number' ? ev.line : null,
    };
  });
}

/**
 * Maps analyzer API endpoint facts to the AnalysisResult apiEndpoint sub-document schema.
 *
 * @param {Array} endpoints - Raw API endpoint facts from analyzer
 * @returns {Array<{ method: string, path: string, file: string|null, source: string|null, line: number|null }>}
 */
function mapApiEndpoints(endpoints) {
  if (!Array.isArray(endpoints)) return [];
  return endpoints.map((ep) => {
    const filePath = (ep && (ep.file || ep.source)) ? String(ep.file || ep.source).trim() : null;
    return {
      method: ep.method,
      path: ep.path,
      file: filePath,
      source: filePath,
      line: typeof ep.line === 'number' ? ep.line : null,
    };
  });
}

const SECTION_TO_TYPE = {
  dependencies: 'production',
  devDependencies: 'development',
  peerDependencies: 'peer',
  optionalDependencies: 'optional',
};

const VALID_SCHEMA_TYPES = new Set(['production', 'development', 'peer', 'optional', 'unknown']);

/**
 * Maps analyzer dependency facts to the AnalysisResult dependency sub-document schema.
 *
 * Translates the analyzer's manifest `section` field into the database schema's `type` enum:
 *   dependencies         → 'production'
 *   devDependencies      → 'development'
 *   peerDependencies     → 'peer'
 *   optionalDependencies → 'optional'
 *   missing / unknown    → 'unknown'
 *
 * SECURITY & INTEGRITY:
 *   - Preserves `name` (required string) and `version` (string or null).
 *   - Strips internal fact metadata (`type: 'DEPENDENCY'`, `source`).
 *   - Never passes the analyzer fact type ('DEPENDENCY') into the schema enum.
 *
 * @param {Array} dependencies - Raw dependency facts from analyzer
 * @returns {Array<{ name: string, version: string|null, type: string }>}
 */
function mapDependencies(dependencies) {
  if (!Array.isArray(dependencies)) return [];
  return dependencies
    .filter((dep) => dep && typeof dep.name === 'string' && dep.name.trim().length > 0)
    .map((dep) => {
      let type = 'unknown';
      if (dep.section && SECTION_TO_TYPE[dep.section]) {
        type = SECTION_TO_TYPE[dep.section];
      } else if (dep.type && dep.type !== 'DEPENDENCY' && VALID_SCHEMA_TYPES.has(dep.type)) {
        type = dep.type;
      }
      return {
        name: dep.name.trim(),
        version: typeof dep.version === 'string' ? dep.version : null,
        type,
      };
    });
}

/**
 * Maps analyzer script facts to the AnalysisResult script sub-document schema.
 *
 * @param {Array} scripts - Raw script facts from analyzer
 * @returns {Array<{ name: string, command: string|null }>}
 */
function mapScripts(scripts) {
  if (!Array.isArray(scripts)) return [];
  return scripts
    .filter((s) => s && typeof s.name === 'string' && s.name.trim().length > 0)
    .map((s) => ({
      name: s.name.trim(),
      command: typeof s.command === 'string' ? s.command : null,
    }));
}

/**
 * Builds the AnalysisResult facts sub-document from the analyzer's facts output.
 * Field name translation:
 *   analyzer: environmentVariables  →  schema: envVars
 *
 * @param {Object} facts - analyzer result.facts
 * @returns {Object} { code, documentation }
 */
function mapFacts(facts) {
  const codeFacts = facts.codeFacts || {};
  const docFacts  = facts.documentationFacts || {};

  return {
    code: {
      apiEndpoints: mapApiEndpoints(codeFacts.apiEndpoints),
      envVars:      mapEnvVars(codeFacts.environmentVariables),
      dependencies: mapDependencies(codeFacts.dependencies),
      scripts:      mapScripts(codeFacts.scripts),
    },
    documentation: {
      apiEndpoints: mapApiEndpoints(docFacts.apiEndpoints),
      envVars:      mapEnvVars(docFacts.environmentVariables),
    },
  };
}

/**
 * Maps analyzer finding evidence to the AnalysisResult evidence sub-document schema.
 * Preserves file paths, source attribution, line numbers, and context tags.
 *
 * @param {Object|null} evidence - Raw evidence object from analyzer finding
 * @returns {Object|null} Mapped evidence conforming to schema
 */
function mapEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') return null;

  const filePath = (evidence.file || evidence.source)
    ? String(evidence.file || evidence.source).trim()
    : null;

  return {
    file: filePath,
    source: filePath,
    line: typeof evidence.line === 'number' ? evidence.line : null,
    method: evidence.method || null,
    path: evidence.path || null,
    name: evidence.name || null,
    prefixResolved: Boolean(evidence.prefixResolved),
    fromTemplate: Boolean(evidence.fromTemplate),
    fromOpenApi: Boolean(evidence.fromOpenApi),
    fromCurl: Boolean(evidence.fromCurl),
    fromTable: Boolean(evidence.fromTable),
    fromDocumentation: Boolean(evidence.fromDocumentation),
  };
}

/**
 * Maps analyzer drift detection result to the AnalysisResult drift schema.
 *
 * @param {Object} drift - Raw drift object from analyzer
 * @returns {Object} Mapped drift with summary and findings
 */
function mapDrift(drift) {
  const defaultSummary = { total: 0, high: 0, medium: 0, low: 0 };
  if (!drift || typeof drift !== 'object') {
    return { summary: defaultSummary, findings: [] };
  }

  const rawSummary = drift.summary || {};
  const summary = {
    total:  typeof rawSummary.total === 'number'  ? rawSummary.total  : 0,
    high:   typeof rawSummary.high === 'number'   ? rawSummary.high   : 0,
    medium: typeof rawSummary.medium === 'number' ? rawSummary.medium : 0,
    low:    typeof rawSummary.low === 'number'    ? rawSummary.low    : 0,
  };

  const rawFindings = Array.isArray(drift.findings) ? drift.findings : [];
  const findings = rawFindings.map((finding) => ({
    type:                  finding.type,
    severity:              finding.severity,
    title:                 finding.title,
    message:               finding.message,
    resource:              finding.resource || {},
    codeEvidence:          mapEvidence(finding.codeEvidence),
    documentationEvidence: mapEvidence(finding.documentationEvidence),
  }));

  return { summary, findings };
}



/**
 * Safely transitions a scan to FAILED.
 * Swallows errors from the update itself to avoid masking the original failure.
 *
 * @param {string|object} scanId
 * @param {string|Object} safeMessage
 * @param {string|null} [workerId=null]
 */
async function markFailed(scanId, safeMessage, workerId = null) {
  try {
    return await markTerminalFailure(scanId, safeMessage, workerId);
  } catch (updateErr) {
    console.error(`[scanExecution] Failed to mark scan ${scanId} as FAILED:`, updateErr.message);
  }
}

/**
 * Handles execution failure for a scan.
 * If claimed by a worker, error is retryable, and attempts < maxAttempts:
 *   Schedules an exponential backoff retry (QUEUED with nextRunAt in future).
 * Otherwise:
 *   Transitions to terminal FAILED status, releases activeScanKey.
 *
 * @param {Object} scan - Scan document
 * @param {Error|unknown} err - Caught error
 * @param {Object} [options={}] - Execution options containing workerId, onExecutionError, etc.
 * @returns {Promise<Object|null>}
 */
async function handleFailure(scan, err, options = {}) {
  const workerId = options.workerId || scan.lockedBy || null;

  if (typeof options.onExecutionError === 'function') {
    try {
      await options.onExecutionError(err);
    } catch (cbErr) {
      console.error('[scanExecution] Error during onExecutionError callback:', cbErr.message);
    }
  }

  const errorInfo = classifyError(err);

  const attempts = typeof scan.attempts === 'number' ? scan.attempts : 1;
  const maxAttempts = typeof scan.maxAttempts === 'number' ? scan.maxAttempts : 3;

  if (workerId && errorInfo.retryable && attempts < maxAttempts) {
    const retried = await scheduleRetry(scan, errorInfo, workerId);
    if (retried) return retried;
  }

  return await markTerminalFailure(scan._id, errorInfo, workerId);
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

/**
 * Executes the full analysis pipeline for a scan in QUEUED status.
 *
 * Designed to be called from an async scheduler (currently setImmediate in-process)
 * and runs independently of the HTTP request lifecycle.
 * Can be replaced by a queue worker by calling executeScan(scanId) from the worker.
 *
 * @param {string|object} scanId - ID of the Scan to execute.
 * @returns {Promise<void>}
 */
const executeScan = async (scanId, options = {}) => {
  // ── Step 1: Claim or verify the scan ──────────────────────────────────────
  // If already claimed by a background worker (QUEUED → RUNNING), use the claimed scan.
  // Otherwise, atomically claim it (in-process fallback / direct call).
  let scan;
  if (options.alreadyClaimed && options.claimedScan) {
    scan = options.claimedScan;
  } else {
    try {
      scan = await Scan.findOneAndUpdate(
        { _id: scanId, status: 'QUEUED' },
        { $set: { status: 'RUNNING', startedAt: new Date() } },
        { returnDocument: 'after' }
      );
    } catch (err) {
      console.error(`[scanExecution] Failed to claim scan ${scanId}:`, err.message);
      return;
    }
  }

  if (!scan) {
    // Scan already claimed or does not exist — abort silently
    console.warn(`[scanExecution] Scan ${scanId} not claimable (already RUNNING/COMPLETED/FAILED or missing).`);
    return;
  }

  console.log(`[scanExecution] Scan ${scan._id} → RUNNING (branch: ${scan.branch}, sha: ${scan.commitSha})`);

  // ── Step 2: Load Repository ───────────────────────────────────────────────
  let repository;
  try {
    repository = await Repository.findById(scan.repositoryId);
  } catch (err) {
    console.error(`[scanExecution] Failed to load repository for scan ${scan._id}:`, err.message);
    await handleFailure(scan, err, options);
    return;
  }

  if (!repository) {
    console.error(`[scanExecution] Repository ${scan.repositoryId} not found for scan ${scan._id}.`);
    const notFoundErr = new Error('The repository associated with this scan no longer exists.');
    notFoundErr.statusCode = 404;
    await handleFailure(scan, notFoundErr, options);
    return;
  }

  // Check if lease ownership was lost before calling analyzer
  if (options.isLeaseLost && options.isLeaseLost()) {
    console.warn(`[scanExecution] Scan ${scan._id} lost lease ownership before analyzer invocation. Aborting.`);
    return;
  }

  // ── Step 3: Call the Analyzer ─────────────────────────────────────────────
  let analyzerResult;
  try {
    analyzerResult = await analyzerService.analyze({
      repository: repository.fullName,   // "owner/repo"
      branch:     scan.branch,
      commitSha:  scan.commitSha,
    });
  } catch (err) {
    console.error(`[scanExecution] Analyzer failed for scan ${scan._id}:`, err.message);
    await handleFailure(scan, err, options);
    return;
  }

  // Check if lease ownership was lost during long-running analysis
  if (options.isLeaseLost && options.isLeaseLost()) {
    console.warn(`[scanExecution] Scan ${scan._id} lost lease ownership during analysis. Aborting result persistence.`);
    return;
  }

  // ── Step 4: Persist AnalysisResult ────────────────────────────────────────
  // Map analyzer output → AnalysisResult fields.
  // NEVER includes the raw files[] inventory (security/structural contract).
  let analysisResult;
  try {
    // Check if an AnalysisResult already exists for this scanId (e.g. after crash before completion)
    const existingResult = await AnalysisResult.findOne({ scanId: scan._id });
    if (existingResult) {
      if (existingResult.repositoryId.toString() === scan.repositoryId.toString()) {
        console.log(`[scanExecution] Found existing AnalysisResult ${existingResult._id} for scan ${scan._id}. Reusing.`);
        analysisResult = existingResult;
      } else {
        throw new Error(`AnalysisResult ${existingResult._id} repository mismatch for scan ${scan._id}.`);
      }
    } else {
      const fileCounts = mapFileCounts(analyzerResult.statistics || {});
      const facts      = mapFacts(analyzerResult.facts || {});
      const drift      = mapDrift(analyzerResult.drift);
      const importantFiles = analyzerResult.importantFiles || {};
      const warnings = (analyzerResult.facts && Array.isArray(analyzerResult.facts.warnings))
        ? analyzerResult.facts.warnings
        : [];

      try {
        analysisResult = await AnalysisResult.create({
          scanId:          scan._id,
          repositoryId:    scan.repositoryId,
          userId:          scan.userId,
          commitSha:       scan.commitSha,
          branch:          scan.branch,
          analyzerVersion: ANALYZER_VERSION,
          fileCounts,
          facts,
          drift,
          importantFiles,
          warnings,
        });
      } catch (createErr) {
        if (createErr.code === 11000) {
          const isScanIdCollision =
            (createErr.keyPattern && createErr.keyPattern.scanId) ||
            (createErr.message && createErr.message.includes('scanId'));

          if (isScanIdCollision) {
            console.warn(`[scanExecution] Duplicate key on scanId for scan ${scan._id}. Retrieving existing result.`);
            const recoveredResult = await AnalysisResult.findOne({ scanId: scan._id });
            if (recoveredResult && recoveredResult.repositoryId.toString() === scan.repositoryId.toString()) {
              analysisResult = recoveredResult;
            } else {
              throw createErr;
            }
          } else {
            // Collision is on an unrelated index — do NOT swallow!
            throw createErr;
          }
        } else {
          throw createErr;
        }
      }
    }
  } catch (err) {
    console.error(`[scanExecution] AnalysisResult persistence failed for scan ${scan._id}:`, err.message);
    await handleFailure(scan, err, options);
    return;
  }

  // ── Step 5: Update Scan metrics and mark COMPLETED ────────────────────────
  // Only mark COMPLETED after AnalysisResult is successfully persisted.
  // Invariant: COMPLETED ↔ AnalysisResult exists.
  try {
    const filesScanned  = (analyzerResult.statistics && analyzerResult.statistics.totalFiles)          || 0;
    const findingsCount = (analyzerResult.drift && analyzerResult.drift.summary && analyzerResult.drift.summary.total) || 0;

    const filter = { _id: scan._id, status: 'RUNNING' };
    if (options.workerId) {
      filter.lockedBy = options.workerId;
    }

    const completedScan = await Scan.findOneAndUpdate(
      filter,
      {
        $set: {
          status:       'COMPLETED',
          completedAt:  new Date(),
          filesScanned,
          findingsCount,
          activeScanKey: null,
          lockedBy: null,
          leaseExpiresAt: null,
        },
      },
      { returnDocument: 'after' }
    );

    if (!completedScan) {
      console.warn(`[scanExecution] Scan ${scan._id} lost lease or status changed before completion finalization.`);
      return;
    }

    console.log(
      `[scanExecution] Scan ${scan._id} → COMPLETED ` +
      `(files: ${filesScanned}, findings: ${findingsCount}, result: ${analysisResult._id})`
    );
  } catch (err) {
    // AnalysisResult IS persisted but scan transition failed — mark FAILED for safety.
    console.error(`[scanExecution] Failed to mark scan ${scan._id} as COMPLETED:`, err.message);
    await handleFailure(scan, err, options);
  }
};

module.exports = {
  executeScan,
  handleFailure,
  ANALYZER_VERSION,
  mapDependencies,
  mapScripts,
  mapFacts,
  mapEnvVars,
  mapApiEndpoints,
  mapEvidence,
  mapDrift,
  mapFileCounts,
};

