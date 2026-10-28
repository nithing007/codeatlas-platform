/**
 * Analyzer Service (Backend)
 *
 * Dedicated HTTP client for communicating with the CodeAtlas Analyzer service.
 * All backend code that needs to invoke the analyzer must use this service —
 * no other module should make raw HTTP calls to the analyzer directly.
 *
 * Responsibilities:
 * - Build the request URL from configuration.
 * - Attach the internal service authentication token.
 * - Send the validated analysis request body.
 * - Handle HTTP and connection errors gracefully.
 * - Validate that the response has the expected top-level structure.
 * - Return the structured analyzer result to the caller.
 *
 * This service does NOT:
 * - Persist anything (persistence is the caller's responsibility).
 * - Expose the internal token in errors or logs.
 * - Trust arbitrary analyzer responses blindly.
 */

const config = require('../config');

// ---------------------------------------------------------------------------
// Expected top-level keys in a valid analyzer response
// ---------------------------------------------------------------------------

const REQUIRED_RESPONSE_KEYS = ['repository', 'statistics', 'facts', 'drift'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a structured internal error for analyzer communication failures.
 *
 * @param {string} message - Human-readable error message (safe for logging, no secrets).
 * @param {number} [statusCode=502] - HTTP-equivalent status code.
 * @returns {Error}
 */
function analyzerError(message, statusCode = 502) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.isAnalyzerError = true;
  return err;
}

/**
 * Validates that the analyzer response contains all required top-level keys.
 *
 * @param {unknown} body - Parsed response body.
 * @returns {boolean}
 */
function isValidAnalyzerResponse(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  return REQUIRED_RESPONSE_KEYS.every((key) => key in body);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sends a static analysis request to the CodeAtlas Analyzer service.
 *
 * @param {Object} params
 * @param {string} params.repository - Canonical GitHub identifier "owner/repo".
 * @param {string} params.branch     - Branch name to analyze.
 * @param {string} params.commitSha  - 40-character Git commit SHA for correlation.
 * @returns {Promise<Object>} Full analyzer result with repository, statistics, facts, and drift.
 * @throws {Error} With statusCode property on analyzer communication failure.
 */
const analyze = async ({ repository, branch, commitSha }) => {
  const analyzerUrl = config.analyzerUrl;
  const token = config.analyzerInternalToken;
  const timeoutMs = config.analyzerTimeoutMs;

  const url = `${analyzerUrl}/api/analyze`;

  // Build request payload
  const body = JSON.stringify({ repository, branch, commitSha });

  // Set up abort controller for timeout
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Internal service auth — never logged, never returned to users
        Authorization: `Bearer ${token}`,
      },
      body,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);

    if (err.name === 'AbortError') {
      throw analyzerError(
        `Analyzer request timed out after ${timeoutMs}ms.`,
        504
      );
    }

    // Connection refused, DNS failure, network error, etc.
    throw analyzerError(
      `Could not connect to the analyzer service. Ensure it is running at ${analyzerUrl}.`,
      503
    );
  } finally {
    clearTimeout(timer);
  }

  // ---- Handle HTTP error responses ----

  if (response.status === 400) {
    let detail = 'Invalid analysis request.';
    try {
      const errorBody = await response.json();
      if (errorBody?.error?.message) {
        detail = errorBody.error.message;
      }
    } catch {
      // Ignore parse errors — use default message
    }
    throw analyzerError(`Analyzer rejected the request: ${detail}`, 400);
  }

  if (response.status === 401) {
    // Do not include token details in the error
    throw analyzerError(
      'Backend is not authorized to call the analyzer. Check ANALYZER_INTERNAL_TOKEN configuration.',
      502
    );
  }

  if (response.status === 404) {
    throw analyzerError(
      'The requested repository or branch was not found on GitHub.',
      404
    );
  }

  if (response.status === 429) {
    throw analyzerError(
      'GitHub API rate limit exceeded. Please try again later.',
      429
    );
  }

  if (response.status >= 500) {
    throw analyzerError(
      `Analyzer service returned an error (HTTP ${response.status}). Please try again.`,
      502
    );
  }

  if (!response.ok) {
    throw analyzerError(
      `Unexpected analyzer response (HTTP ${response.status}).`,
      502
    );
  }

  // ---- Parse and validate response body ----

  let result;
  try {
    result = await response.json();
  } catch {
    throw analyzerError(
      'Analyzer returned a malformed (non-JSON) response.',
      502
    );
  }

  if (!isValidAnalyzerResponse(result)) {
    throw analyzerError(
      'Analyzer response is missing required fields (repository, statistics, facts, drift).',
      502
    );
  }

  return result;
};

module.exports = { analyze };
