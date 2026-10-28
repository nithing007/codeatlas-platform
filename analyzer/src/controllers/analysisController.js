/**
 * Analysis Controller
 *
 * Handles HTTP requests for:
 *   GET  /api/health    — service health check (public)
 *   POST /api/analyze   — run static analysis on a GitHub repository (internal only)
 *
 * The controller invokes the existing RepositoryScanner pipeline.
 * It does NOT:
 * - Connect to MongoDB
 * - Store any results
 * - Execute repository code
 * - Use child_process
 * - Leak secrets, tokens, or stack traces
 */

const RepositoryScanner = require('../scanner/repositoryScanner');
const GitHubRepositoryProvider = require('../providers/githubRepositoryProvider');

// ---------------------------------------------------------------------------
// Validation constants
// ---------------------------------------------------------------------------

/**
 * Validates a canonical GitHub owner/repo identifier.
 * Accepts alphanumeric characters, hyphens, underscores, and dots in each segment.
 * Does NOT accept full URLs — only "owner/repo" form.
 *
 * Examples:
 *   "expressjs/express"     → valid
 *   "my-org/My_Repo.js"    → valid
 *   "https://github.com/…" → invalid
 */
const REPO_IDENTITY_RE = /^[a-zA-Z0-9._-]{1,100}\/[a-zA-Z0-9._-]{1,100}$/;

/**
 * Validates a 40-character lowercase hexadecimal Git commit SHA.
 */
const COMMIT_SHA_RE = /^[0-9a-f]{40}$/i;

/**
 * Maximum length for a branch name.
 */
const MAX_BRANCH_LENGTH = 255;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sends a structured 400 validation error response.
 *
 * @param {import('express').Response} res
 * @param {string} message - Human-readable description of what is invalid.
 */
function sendValidationError(res, message) {
  return res.status(400).json({
    error: {
      code: 'INVALID_ANALYSIS_REQUEST',
      message,
    },
  });
}

// ---------------------------------------------------------------------------
// Controllers
// ---------------------------------------------------------------------------

/**
 * GET /api/health
 * Public endpoint. Returns service status without exposing internals.
 */
const healthCheck = (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'analyzer',
  });
};

/**
 * POST /api/analyze
 * Internal endpoint (requires internalAuth middleware).
 *
 * Validates the request body, then runs the full analysis pipeline:
 *   GitHubRepositoryProvider → RepositoryScanner → facts + drift → HTTP response
 *
 * Request body:
 * {
 *   "repository": "owner/repo",   // canonical GitHub identity — NOT a URL
 *   "branch":     "main",
 *   "commitSha":  "<40-char hex SHA>"
 * }
 *
 * On success: returns the full analyzer result (200).
 * On validation failure: returns structured 400.
 * On analysis failure: returns structured 500 without stack traces or secrets.
 */
const analyze = async (req, res, next) => {
  try {
    const { repository, branch, commitSha } = req.body || {};

    // ---- Validate: repository ----
    if (!repository || typeof repository !== 'string') {
      return sendValidationError(res, 'repository is required and must be a string.');
    }
    const trimmedRepo = repository.trim();
    if (!REPO_IDENTITY_RE.test(trimmedRepo)) {
      return sendValidationError(
        res,
        'repository must be in "owner/repo" format using alphanumeric characters, hyphens, underscores, or dots. URLs are not accepted.'
      );
    }

    // ---- Validate: branch ----
    if (!branch || typeof branch !== 'string') {
      return sendValidationError(res, 'branch is required and must be a non-empty string.');
    }
    const trimmedBranch = branch.trim();
    if (trimmedBranch.length === 0) {
      return sendValidationError(res, 'branch must not be empty.');
    }
    if (trimmedBranch.length > MAX_BRANCH_LENGTH) {
      return sendValidationError(res, `branch must not exceed ${MAX_BRANCH_LENGTH} characters.`);
    }

    // ---- Validate: commitSha ----
    if (!commitSha || typeof commitSha !== 'string') {
      return sendValidationError(res, 'commitSha is required and must be a string.');
    }
    if (!COMMIT_SHA_RE.test(commitSha.trim())) {
      return sendValidationError(res, 'commitSha must be a valid 40-character Git SHA (hexadecimal).');
    }

    // ---- Split owner/repo ----
    const [owner, repo] = trimmedRepo.split('/');

    // ---- Invoke existing analyzer pipeline ----
    const provider = new GitHubRepositoryProvider();
    const scanner = new RepositoryScanner(provider);

    // The scanner fetches its own commitSha from GitHub to guarantee freshness.
    // The caller-supplied commitSha is used for request correlation only.
    const result = await scanner.scan(owner, repo, trimmedBranch);

    // Return the full analyzer result — the Backend persistence layer decides
    // what to store. We do not strip files[] or any other fields here.
    return res.status(200).json(result);
  } catch (err) {
    // Map known GitHub provider status codes to appropriate HTTP responses.
    // Do not expose stack traces, file paths, or secrets.
    const statusCode = err.statusCode;

    if (statusCode === 404) {
      return res.status(404).json({
        error: {
          code: 'REPOSITORY_NOT_FOUND',
          message: 'The requested repository or branch was not found on GitHub.',
        },
      });
    }

    if (statusCode === 429) {
      return res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'GitHub API rate limit exceeded. Please try again later.',
        },
      });
    }

    if (statusCode === 504) {
      return res.status(504).json({
        error: {
          code: 'GITHUB_TIMEOUT',
          message: 'The GitHub API request timed out.',
        },
      });
    }

    if (statusCode === 502) {
      return res.status(502).json({
        error: {
          code: 'GITHUB_NETWORK_ERROR',
          message: 'A network error occurred while communicating with GitHub.',
        },
      });
    }

    // Generic analysis failure — log server-side but return safe message
    console.error('[analyzer] Analysis failed:', err.message);

    return res.status(500).json({
      error: {
        code: 'ANALYSIS_FAILED',
        message: 'Analysis could not be completed. Please try again.',
      },
    });
  }
};

module.exports = { healthCheck, analyze };
