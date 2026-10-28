/**
 * Finding Factory
 *
 * Provides a single, consistent constructor for all drift findings.
 * Every finding created by the drift engine MUST go through this factory
 * to guarantee schema consistency.
 *
 * Finding Schema:
 * {
 *   type:                  string   — UNDOCUMENTED_API | OBSOLETE_API_DOCUMENTATION |
 *                                     UNDOCUMENTED_ENVIRONMENT_VARIABLE | OBSOLETE_ENVIRONMENT_VARIABLE
 *   severity:              string   — HIGH | MEDIUM | LOW
 *   title:                 string   — Human-readable one-line title
 *   message:               string   — Human-readable description using conservative language
 *   resource:              Object   — The subject of the finding (endpoint or env var)
 *   codeEvidence:          Object|null — Where in the code the fact was observed
 *   documentationEvidence: Object|null — Where in documentation the fact was observed
 * }
 */

const VALID_SEVERITIES = new Set(['HIGH', 'MEDIUM', 'LOW']);
const VALID_TYPES = new Set([
  'UNDOCUMENTED_API',
  'OBSOLETE_API_DOCUMENTATION',
  'UNDOCUMENTED_ENVIRONMENT_VARIABLE',
  'OBSOLETE_ENVIRONMENT_VARIABLE',
]);

/**
 * Creates a validated, immutable drift finding object.
 *
 * @param {Object} params
 * @param {string} params.type - Finding type constant.
 * @param {string} params.severity - HIGH | MEDIUM | LOW
 * @param {string} params.title - Short human-readable title.
 * @param {string} params.message - Explanatory message using conservative language.
 * @param {Object} params.resource - The resource being described (endpoint or env var).
 * @param {Object|null} [params.codeEvidence] - Code-side evidence.
 * @param {Object|null} [params.documentationEvidence] - Documentation-side evidence.
 * @returns {Readonly<Object>} Immutable finding object.
 * @throws {Error} If required fields are missing or invalid.
 */
const createFinding = ({
  type,
  severity,
  title,
  message,
  resource,
  codeEvidence = null,
  documentationEvidence = null,
}) => {
  if (!VALID_TYPES.has(type)) {
    throw new Error(`[findingFactory] Unknown finding type: "${type}"`);
  }
  if (!VALID_SEVERITIES.has(severity)) {
    throw new Error(`[findingFactory] Invalid severity: "${severity}". Must be HIGH, MEDIUM, or LOW.`);
  }
  if (!title || typeof title !== 'string') {
    throw new Error('[findingFactory] Finding must have a non-empty title string.');
  }
  if (!message || typeof message !== 'string') {
    throw new Error('[findingFactory] Finding must have a non-empty message string.');
  }
  if (!resource || typeof resource !== 'object') {
    throw new Error('[findingFactory] Finding must include a resource object.');
  }

  return Object.freeze({
    type,
    severity,
    title,
    message,
    resource,
    codeEvidence: codeEvidence || null,
    documentationEvidence: documentationEvidence || null,
  });
};

/**
 * Builds the drift result wrapper containing summary counts and the findings array.
 *
 * @param {Array<Object>} findings - Array of finding objects created by createFinding.
 * @returns {Object} Structured drift result.
 */
const buildDriftResult = (findings) => {
  const summary = { total: 0, high: 0, medium: 0, low: 0 };
  for (const finding of findings) {
    summary.total++;
    switch (finding.severity) {
      case 'HIGH':   summary.high++;   break;
      case 'MEDIUM': summary.medium++; break;
      case 'LOW':    summary.low++;    break;
    }
  }
  return { summary, findings };
};

module.exports = { createFinding, buildDriftResult, VALID_SEVERITIES, VALID_TYPES };
