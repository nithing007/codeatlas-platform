/**
 * Drift Detector — Orchestrator
 *
 * Accepts extracted facts (from Phase 4B) and runs all drift detection rules
 * across code and documentation facts.
 *
 * Architecture:
 *
 *   detectDrift(facts)
 *     ↓
 *   apiDriftDetector.detectApiDrift(codeFacts.apiEndpoints, documentationFacts.apiEndpoints)
 *     +
 *   envDriftDetector.detectEnvDrift(codeFacts.environmentVariables, documentationFacts.environmentVariables)
 *     ↓
 *   buildDriftResult(allFindings)
 *     ↓
 *   { summary: { total, high, medium, low }, findings: [...] }
 *
 * Guarantees:
 *   - facts.warnings remain SEPARATE from drift.findings.
 *   - All security invariants from Phase 4A/4B are preserved.
 *   - The drift detector never fetches data, never executes code, never calls APIs.
 *   - Operates purely on already-extracted, normalized in-memory fact objects.
 */

const { detectApiDrift } = require('./apiDriftDetector');
const { detectEnvDrift } = require('./envDriftDetector');
const { buildDriftResult } = require('./findingFactory');

/**
 * Runs all drift detection rules over extracted repository facts and returns
 * a structured drift result.
 *
 * @param {Object} facts - The facts object produced by Phase 4B (repositoryScanner or equivalent).
 * @param {Object} facts.codeFacts - Code-side extracted facts.
 * @param {Array<Object>} facts.codeFacts.apiEndpoints - Code API endpoints.
 * @param {Array<Object>} facts.codeFacts.environmentVariables - Code env var references.
 * @param {Object} facts.documentationFacts - Documentation-side extracted facts.
 * @param {Array<Object>} facts.documentationFacts.apiEndpoints - Documentation API endpoints.
 * @param {Array<Object>} facts.documentationFacts.environmentVariables - Documentation env vars.
 * @returns {Object} Drift result: { summary: { total, high, medium, low }, findings: [] }
 */
const detectDrift = (facts) => {
  if (!facts || typeof facts !== 'object') {
    return buildDriftResult([]);
  }

  const codeFacts = facts.codeFacts || {};
  const documentationFacts = facts.documentationFacts || {};

  const codeApiEndpoints  = codeFacts.apiEndpoints  || [];
  const codeEnvVars       = codeFacts.environmentVariables || [];
  const docApiEndpoints   = documentationFacts.apiEndpoints  || [];
  const docEnvVars        = documentationFacts.environmentVariables || [];

  // Run all detection rules
  const apiFindings = detectApiDrift(codeApiEndpoints, docApiEndpoints);
  const envFindings = detectEnvDrift(codeEnvVars, docEnvVars);

  // Combine: API findings first (HIGH), then env findings (MEDIUM/LOW)
  const allFindings = [...apiFindings, ...envFindings];

  return buildDriftResult(allFindings);
};

module.exports = { detectDrift };
