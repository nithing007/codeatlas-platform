/**
 * Environment Variable Drift Detector
 *
 * Compares codeFacts.environmentVariables against documentationFacts.environmentVariables
 * and produces drift findings.
 *
 * Rules:
 *
 *   A) UNDOCUMENTED_ENVIRONMENT_VARIABLE (MEDIUM)
 *      An environment variable is referenced in code (process.env.NAME or .env.example)
 *      but was not found in any documentation source.
 *
 *   B) OBSOLETE_ENVIRONMENT_VARIABLE (LOW)
 *      An environment variable is documented but was not found referenced in the
 *      analyzed source code.
 *      Uses conservative language — static analysis can miss dynamic env var access
 *      (e.g. computed property names, runtime string concatenation).
 *
 * Matching is deterministic:
 *   - Variable names are compared after normalizing whitespace (trim only).
 *   - Case-sensitive by convention (env vars are UPPER_SNAKE_CASE).
 *   - No fuzzy matching. No AI.
 *
 * Security:
 *   - Environment variable VALUES are never included in findings.
 *   - Only variable names are compared and surfaced.
 *
 * Deduplication:
 *   - One finding per unique variable name.
 *   - Multiple code references to the same name produce a single finding.
 *   - Multiple documentation references to the same name produce a single finding.
 */

const { createFinding } = require('./findingFactory');

/**
 * Compares code environment variable facts against documentation environment variable facts.
 *
 * @param {Array<Object>} codeEnvVars - From facts.codeFacts.environmentVariables.
 * @param {Array<Object>} docEnvVars  - From facts.documentationFacts.environmentVariables.
 * @returns {Array<Object>} Array of drift findings.
 */
const detectEnvDrift = (codeEnvVars, docEnvVars) => {
  const findings = [];

  // ---- Build code variable index ----
  // Deduplicate by name — keep first occurrence as primary evidence.
  const codeIndex = new Map(); // name -> first code env var fact
  for (const ev of (codeEnvVars || [])) {
    if (!ev.name) continue;
    if (!codeIndex.has(ev.name)) {
      codeIndex.set(ev.name, ev);
    }
  }

  // ---- Build documentation variable index ----
  // Deduplicate by name — keep first occurrence as primary evidence.
  const docIndex = new Map(); // name -> first doc env var fact
  for (const ev of (docEnvVars || [])) {
    if (!ev.name) continue;
    if (!docIndex.has(ev.name)) {
      docIndex.set(ev.name, ev);
    }
  }

  // ---- Rule A: UNDOCUMENTED_ENVIRONMENT_VARIABLE ----
  // For each unique code variable, check if it appears in documentation.
  for (const [name, codeEv] of codeIndex) {
    if (!docIndex.has(name)) {
      findings.push(createFinding({
        type: 'UNDOCUMENTED_ENVIRONMENT_VARIABLE',
        severity: 'MEDIUM',
        title: 'Undocumented environment variable',
        message: `Environment variable "${name}" is referenced in source code but was not found in repository documentation.`,
        resource: { name },
        codeEvidence: buildCodeEvidence(codeEv),
        documentationEvidence: null,
      }));
    }
  }

  // ---- Rule B: OBSOLETE_ENVIRONMENT_VARIABLE ----
  // For each unique doc variable, check if it appears in code.
  for (const [name, docEv] of docIndex) {
    if (!codeIndex.has(name)) {
      findings.push(createFinding({
        type: 'OBSOLETE_ENVIRONMENT_VARIABLE',
        severity: 'LOW',
        title: 'Documented environment variable not found in source code',
        message: `Environment variable "${name}" is documented but was not found in the analyzed source code. Note: static analysis may not detect all dynamic environment variable accesses.`,
        resource: { name },
        codeEvidence: null,
        documentationEvidence: buildDocEvidence(docEv),
      }));
    }
  }

  return findings;
};

// ---- Evidence builders ----
// Security: these builders must NEVER include variable values.

function buildCodeEvidence(ev) {
  const evidence = { source: ev.source || null };
  if (typeof ev.line === 'number') evidence.line = ev.line;
  if (ev.fromTemplate) evidence.fromTemplate = true;
  // Explicitly: do NOT include ev.value or any actual env variable value
  return evidence;
}

function buildDocEvidence(ev) {
  const evidence = { source: ev.source || null };
  if (typeof ev.line === 'number') evidence.line = ev.line;
  if (ev.fromDocumentation) evidence.fromDocumentation = true;
  // Explicitly: do NOT include ev.value
  return evidence;
}

module.exports = { detectEnvDrift };
