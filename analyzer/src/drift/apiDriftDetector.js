/**
 * API Drift Detector
 *
 * Compares codeFacts.apiEndpoints against documentationFacts.apiEndpoints
 * and produces drift findings.
 *
 * Rules:
 *
 *   A) UNDOCUMENTED_API (HIGH)
 *      An endpoint exists in code but was not found in any documentation source.
 *
 *   B) OBSOLETE_API_DOCUMENTATION (MEDIUM)
 *      An endpoint exists in documentation but was not found in the analyzed code.
 *      Uses conservative language — static analysis can miss dynamically generated routes.
 *
 * Matching is deterministic:
 *   - HTTP method (normalized to uppercase) must match exactly.
 *   - Path (normalized) must match exactly.
 *   - No fuzzy matching. No AI. No guessing.
 *
 * Deduplication:
 *   - For UNDOCUMENTED_API: one finding per unique (method, path) code fact.
 *   - For OBSOLETE_API_DOCUMENTATION: one finding per unique (method, path) doc fact,
 *     with evidence consolidated from all doc sources that mention it.
 *   - Multiple documentation files referencing the same endpoint do not produce
 *     multiple findings — the first-observed evidence is preserved in the finding.
 */

const { createFinding } = require('./findingFactory');

/**
 * Compares code API endpoint facts against documentation API endpoint facts.
 *
 * @param {Array<Object>} codeEndpoints - From facts.codeFacts.apiEndpoints.
 * @param {Array<Object>} docEndpoints  - From facts.documentationFacts.apiEndpoints.
 * @returns {Array<Object>} Array of drift findings.
 */
const detectApiDrift = (codeEndpoints, docEndpoints) => {
  const findings = [];

  // Build a lookup key: "METHOD:/normalized/path"
  const makeKey = (method, path) => `${method}:${path}`;

  // ---- Build code endpoint index ----
  // Deduplicate by (method, path). Keep first occurrence as primary evidence.
  const codeIndex = new Map(); // key -> first code endpoint fact
  for (const ep of (codeEndpoints || [])) {
    if (!ep.method || !ep.path) continue;
    const key = makeKey(ep.method, ep.path);
    if (!codeIndex.has(key)) {
      codeIndex.set(key, ep);
    }
  }

  // ---- Build documentation endpoint index ----
  // Deduplicate by (method, path). Keep first occurrence as primary evidence.
  const docIndex = new Map(); // key -> first doc endpoint fact
  for (const ep of (docEndpoints || [])) {
    if (!ep.method || !ep.path) continue;
    const key = makeKey(ep.method, ep.path);
    if (!docIndex.has(key)) {
      docIndex.set(key, ep);
    }
  }

  // ---- Rule A: UNDOCUMENTED_API ----
  // For each unique code endpoint, check if a matching doc endpoint exists.
  for (const [key, codeEp] of codeIndex) {
    if (!docIndex.has(key)) {
      findings.push(createFinding({
        type: 'UNDOCUMENTED_API',
        severity: 'HIGH',
        title: 'Undocumented API endpoint',
        message: `${codeEp.method} ${codeEp.path} exists in source code but was not found in repository documentation.`,
        resource: {
          method: codeEp.method,
          path: codeEp.path,
        },
        codeEvidence: buildCodeEvidence(codeEp),
        documentationEvidence: null,
      }));
    }
  }

  // ---- Rule B: OBSOLETE_API_DOCUMENTATION ----
  // For each unique doc endpoint, check if a matching code endpoint exists.
  for (const [key, docEp] of docIndex) {
    if (!codeIndex.has(key)) {
      findings.push(createFinding({
        type: 'OBSOLETE_API_DOCUMENTATION',
        severity: 'MEDIUM',
        title: 'Documented API endpoint not found in source code',
        message: `${docEp.method} ${docEp.path} is documented but was not found in the analyzed source code. Note: static analysis may not detect all dynamically registered routes.`,
        resource: {
          method: docEp.method,
          path: docEp.path,
        },
        codeEvidence: null,
        documentationEvidence: buildDocEvidence(docEp),
      }));
    }
  }

  return findings;
};

// ---- Evidence builders ----

function buildCodeEvidence(ep) {
  const evidence = { source: ep.source || null };
  if (typeof ep.line === 'number') evidence.line = ep.line;
  if (ep.prefixResolved) evidence.prefixResolved = true;
  if (ep.fromOpenApi) evidence.fromOpenApi = true;
  return evidence;
}

function buildDocEvidence(ep) {
  const evidence = { source: ep.source || null };
  if (typeof ep.line === 'number') evidence.line = ep.line;
  if (ep.fromOpenApi) evidence.fromOpenApi = true;
  if (ep.fromCurl) evidence.fromCurl = true;
  return evidence;
}

module.exports = { detectApiDrift };
