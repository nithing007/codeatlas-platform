/**
 * Centralized API client for CodeAtlas frontend.
 *
 * - Uses VITE_API_BASE_URL from environment.
 * - Sends credentials (HttpOnly cookie) with every request.
 * - Normalizes API errors from the backend's error shape:
 *     { success: false, error: "message" }        — plain string
 *     { success: false, error: { code, message } } — structured
 * - Preserves HTTP status codes.
 * - Handles empty responses, network failures, and server unavailability.
 * - Does NOT log credentials, OTPs, cookies, or other sensitive values.
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

// ─── Error class ──────────────────────────────────────────────────────────────

export class ApiError extends Error {
  /**
   * @param {string}      message   Human-readable message.
   * @param {number}      status    HTTP status code (0 for network errors).
   * @param {string|null} code      Machine-readable error code from backend, if present.
   */
  constructor(message, status, code = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

// ─── Response normalization ───────────────────────────────────────────────────

/**
 * Parse the fetch Response and normalize errors.
 * @param {Response} response
 * @returns {Promise<any>} Parsed JSON body on success.
 * @throws {ApiError}
 */
async function parseResponse(response) {
  // Some endpoints return no body (204, etc.)
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  let body = null;
  if (isJson) {
    try {
      body = await response.json();
    } catch {
      // Malformed JSON — treat as server error
      throw new ApiError('Invalid response from server', response.status);
    }
  }

  if (!response.ok) {
    // Extract message and code from the backend error shape
    let message = `Request failed with status ${response.status}`;
    let code = null;

    if (body) {
      if (typeof body.error === 'string') {
        message = body.error;
      } else if (body.error && typeof body.error === 'object') {
        message = body.error.message || message;
        code = body.error.code || null;
      }
    }

    throw new ApiError(message, response.status, code);
  }

  return body;
}

// ─── Core fetch wrapper ───────────────────────────────────────────────────────

/**
 * Make a credentialed fetch request to the backend API.
 *
 * @param {string} path     Path relative to BASE_URL (e.g. '/auth/me').
 * @param {object} options  Standard fetch options (method, body, signal, etc.).
 * @returns {Promise<any>}
 * @throws {ApiError}
 */
async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;

  const config = {
    credentials: 'include', // send HttpOnly auth cookie
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  };

  // Remove Content-Type for requests without a body to avoid CORS preflight issues
  if (!options.body) {
    delete config.headers['Content-Type'];
  }

  let response;
  try {
    response = await fetch(url, config);
  } catch {
    // Network failures — server unreachable, DNS, etc.
    throw new ApiError(
      'Unable to reach the server. Please check your connection.',
      0
    );
  }

  return parseResponse(response);
}

// ─── Convenience methods ──────────────────────────────────────────────────────

const api = {
  /**
   * GET request.
   * @param {string} path
   * @param {{ signal?: AbortSignal }} [opts]
   */
  get(path, opts = {}) {
    return request(path, { method: 'GET', signal: opts.signal });
  },

  /**
   * POST request with JSON body.
   * @param {string} path
   * @param {object} body
   * @param {{ signal?: AbortSignal }} [opts]
   */
  post(path, body, opts = {}) {
    return request(path, {
      method: 'POST',
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  },

  /**
   * PUT request with JSON body.
   * @param {string} path
   * @param {object} body
   * @param {{ signal?: AbortSignal }} [opts]
   */
  put(path, body, opts = {}) {
    return request(path, {
      method: 'PUT',
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  },

  /**
   * DELETE request.
   * @param {string} path
   * @param {{ signal?: AbortSignal }} [opts]
   */
  delete(path, opts = {}) {
    return request(path, { method: 'DELETE', signal: opts.signal });
  },
};

export default api;

/**
 * Build the full backend URL for a given path.
 * Used for browser-redirect flows (Google OAuth).
 * @param {string} path
 * @returns {string}
 */
export function buildBackendUrl(path) {
  return `${BASE_URL}${path}`;
}
