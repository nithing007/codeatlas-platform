/**
 * Fact Normalizer
 * Provides deterministic normalization of extracted code and documentation facts
 * so equivalent facts can be reliably compared in the drift detection engine.
 */

/**
 * Normalizes an HTTP method string to uppercase.
 *
 * @param {string} method - HTTP method string (e.g. 'get', 'POST').
 * @returns {string} Uppercase method, e.g. 'GET'.
 */
const normalizeMethod = (method) => {
  if (!method || typeof method !== 'string') return '';
  return method.trim().toUpperCase();
};

/**
 * Normalizes a route path string.
 * - Strips trailing slashes (unless path is just '/')
 * - Normalizes consecutive slashes to a single slash
 * - Preserves Express-style params (:id) as-is
 * - Does NOT aggressively convert OpenAPI {id} -> :id to avoid false equivalence
 *
 * @param {string} routePath - Route path string.
 * @returns {string} Normalized path.
 */
const normalizePath = (routePath) => {
  if (!routePath || typeof routePath !== 'string') return '';
  let p = routePath.trim();

  // Normalize multiple consecutive slashes
  p = p.replace(/\/+/g, '/');

  // Strip trailing slash unless the entire path is just '/'
  if (p.length > 1 && p.endsWith('/')) {
    p = p.slice(0, -1);
  }

  // Ensure path starts with /
  if (!p.startsWith('/')) {
    p = '/' + p;
  }

  return p;
};

/**
 * Normalizes an environment variable name.
 * Convention is UPPER_SNAKE_CASE, just trim whitespace.
 *
 * @param {string} name - Variable name string.
 * @returns {string} Trimmed name.
 */
const normalizeEnvVarName = (name) => {
  if (!name || typeof name !== 'string') return '';
  return name.trim();
};

module.exports = {
  normalizeMethod,
  normalizePath,
  normalizeEnvVarName,
};
