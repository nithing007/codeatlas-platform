/**
 * Error Classifier Subsystem
 *
 * Provides deterministic error classification, retryability assessment,
 * and error message sanitization for CodeAtlas background job processing.
 */

'use strict';

// ---------------------------------------------------------------------------
// Error Category Constants
// ---------------------------------------------------------------------------

const ERROR_CATEGORIES = {
  TRANSIENT_ANALYZER: 'TRANSIENT_ANALYZER',
  NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',
  RATE_LIMIT: 'RATE_LIMIT',
  TRANSIENT_DB: 'TRANSIENT_DB',
  PERMANENT_CLIENT: 'PERMANENT_CLIENT',
  PERMANENT_NOT_FOUND: 'PERMANENT_NOT_FOUND',
  PERMANENT_AUTH: 'PERMANENT_AUTH',
  PERMANENT_VALIDATION: 'PERMANENT_VALIDATION',
  UNKNOWN: 'UNKNOWN',
};

// ---------------------------------------------------------------------------
// Sanitization Helper
// ---------------------------------------------------------------------------

/**
 * Sanitizes an error message by stripping sensitive tokens, credentials,
 * connection strings, file paths, and stack trace markers.
 *
 * @param {Error|string|unknown} err - Error object or message
 * @returns {string} Safe, human-readable error summary
 */
function sanitizeErrorMessage(err) {
  if (!err) return 'An unexpected error occurred during analysis.';

  let message = typeof err === 'string' ? err : err.message || 'An error occurred';

  // 1. Strip Bearer tokens
  message = message.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]');

  // 2. Strip credentials in MongoDB and HTTP URIs
  message = message.replace(/(mongodb(?:\+srv)?:\/\/[^:]+:)[^@]+(@)/gi, '$1[REDACTED]$2');
  message = message.replace(/(https?:\/\/[^:]+:)[^@]+(@)/gi, '$1[REDACTED]$2');

  // 3. Strip local absolute file paths (Windows & POSIX)
  message = message.replace(/[A-Za-z]:\\[^:\s"'<>]+\b/g, '[FILE_PATH]');
  message = message.replace(/(?:\/[a-zA-Z0-9._-]+){2,}/g, '[FILE_PATH]');

  // 4. Strip internal authorization headers or query tokens
  message = message.replace(/([?&](?:token|key|secret|password)=)[^&]+/gi, '$1[REDACTED]');

  return message.trim();
}

// ---------------------------------------------------------------------------
// Error Classifier Helper
// ---------------------------------------------------------------------------

/**
 * Classifies an error into retryable vs. permanent categories.
 *
 * Conservative Policy:
 * - Retryable: Explicit transient network/analyzer codes (503, 504, 429, 502, network abort/timeouts).
 * - Permanent: Client errors (400, 404), Auth (401, 403), Schema validation (ValidationError, CastError).
 * - Unknown: Treated as PERMANENT by default to avoid endless crash loops on programming bugs.
 *
 * @param {Error|unknown} err - Error to classify
 * @returns {{ retryable: boolean, category: string, statusCode: number|null, sanitizedMessage: string }}
 */
function classifyError(err) {
  const sanitizedMessage = sanitizeErrorMessage(err);

  if (!err || typeof err !== 'object') {
    return {
      retryable: false,
      category: ERROR_CATEGORIES.UNKNOWN,
      statusCode: null,
      sanitizedMessage,
    };
  }

  const statusCode = typeof err.statusCode === 'number' ? err.statusCode : null;
  const name = err.name || '';
  const code = err.code || '';

  // 1. Rate Limit (HTTP 429) -> Retryable
  if (statusCode === 429) {
    return {
      retryable: true,
      category: ERROR_CATEGORIES.RATE_LIMIT,
      statusCode: 429,
      sanitizedMessage: 'GitHub API rate limit exceeded. Please try again later.',
    };
  }

  // 2. Timeout (HTTP 504 or AbortError or ETIMEDOUT) -> Retryable
  if (
    statusCode === 504 ||
    name === 'AbortError' ||
    code === 'ETIMEDOUT' ||
    code === 'ESOCKETTIMEDOUT'
  ) {
    return {
      retryable: true,
      category: ERROR_CATEGORIES.NETWORK_TIMEOUT,
      statusCode: 504,
      sanitizedMessage: 'The analysis request timed out.',
    };
  }

  // 3. Analyzer Unavailable / Connection Refused (HTTP 503, ECONNREFUSED) -> Retryable
  if (
    statusCode === 503 ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EHOSTUNREACH'
  ) {
    return {
      retryable: true,
      category: ERROR_CATEGORIES.TRANSIENT_ANALYZER,
      statusCode: statusCode || 503,
      sanitizedMessage: 'The analyzer service is currently unavailable.',
    };
  }

  // 4. Analyzer 5xx Server Error (HTTP 500, 502) -> Retryable
  if (statusCode && statusCode >= 500 && statusCode < 600) {
    return {
      retryable: true,
      category: ERROR_CATEGORIES.TRANSIENT_ANALYZER,
      statusCode,
      sanitizedMessage: `Analyzer service returned HTTP ${statusCode}. Scheduled for retry.`,
    };
  }

  // 5. Transient Database / Mongo Network Error -> Retryable
  if (
    name === 'MongoNetworkError' ||
    name === 'MongoServerSelectionError' ||
    code === 'ECONNRESET'
  ) {
    return {
      retryable: true,
      category: ERROR_CATEGORIES.TRANSIENT_DB,
      statusCode: null,
      sanitizedMessage: 'Transient database network error. Scheduled for retry.',
    };
  }

  // 6. Not Found (HTTP 404) -> Permanent
  if (statusCode === 404) {
    return {
      retryable: false,
      category: ERROR_CATEGORIES.PERMANENT_NOT_FOUND,
      statusCode: 404,
      sanitizedMessage: 'The repository or branch was not found on GitHub.',
    };
  }

  // 7. Bad Request / Validation (HTTP 400, ValidationError, CastError) -> Permanent
  if (statusCode === 400 || name === 'ValidationError' || name === 'CastError') {
    return {
      retryable: false,
      category: ERROR_CATEGORIES.PERMANENT_VALIDATION,
      statusCode: statusCode || 400,
      sanitizedMessage: sanitizedMessage || 'Invalid repository data or parameters.',
    };
  }

  // 8. Auth Failures (HTTP 401, 403) -> Permanent
  if (statusCode === 401 || statusCode === 403) {
    return {
      retryable: false,
      category: ERROR_CATEGORIES.PERMANENT_AUTH,
      statusCode,
      sanitizedMessage: 'Authentication or permission failure during analysis.',
    };
  }

  // 9. Unknown / Unclassified Error -> Conservative: Permanent
  return {
    retryable: false,
    category: ERROR_CATEGORIES.UNKNOWN,
    statusCode,
    sanitizedMessage: sanitizedMessage || 'An unexpected failure occurred during analysis.',
  };
}

module.exports = {
  ERROR_CATEGORIES,
  sanitizeErrorMessage,
  classifyError,
};
