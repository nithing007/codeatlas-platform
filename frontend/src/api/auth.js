/**
 * Authentication API module.
 * Wraps the backend /api/auth/* endpoints.
 * All request/response shapes are derived from the actual backend implementation.
 *
 * Endpoints:
 *   POST /auth/request-otp   — { email }              → { success, message }
 *   POST /auth/verify-otp    — { email, otp }          → { success, user, isNewUser }
 *   GET  /auth/google        — Browser redirect to Google consent
 *   POST /auth/logout        — No body                 → { success, message }
 *   GET  /auth/me            — No body (uses cookie)   → { success, user }
 */

import api, { buildBackendUrl } from './client.js';

/**
 * Request a 6-digit OTP to be sent to the given email.
 *
 * Backend enforces a resend cooldown (default 60 s) and validates email format.
 * A 429 response means the cooldown is still active.
 *
 * @param {string} email
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function requestOtp(email, signal) {
  return api.post('/auth/request-otp', { email }, { signal });
}

/**
 * Verify the OTP received by email and establish an authenticated session.
 *
 * On success the backend sets an HttpOnly 'codeatlas_auth' cookie.
 * The response body contains safe user info — the JWT is never in the body.
 *
 * @param {string} email
 * @param {string} otp  6-digit string
 * @returns {Promise<{ success: boolean, user: object, isNewUser: boolean }>}
 */
export async function verifyOtp(email, otp, signal) {
  return api.post('/auth/verify-otp', { email, otp }, { signal });
}

/**
 * Return the full backend URL for initiating Google OAuth.
 * The browser must navigate to this URL (not a fetch call) so that the
 * backend can set the oauth_state cookie and issue the 302 redirect to Google.
 *
 * @returns {string}
 */
export function getGoogleAuthUrl() {
  return buildBackendUrl('/auth/google');
}

/**
 * Log out the current user.
 *
 * The backend clears the HttpOnly auth cookie.
 *
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function logout(signal) {
  return api.post('/auth/logout', {}, { signal });
}

/**
 * Fetch the currently authenticated user's profile.
 *
 * Uses the HttpOnly cookie automatically (credentials: 'include').
 * Returns null implicitly if the backend returns 401 — callers must
 * handle ApiError with status 401 as "not authenticated".
 *
 * @returns {Promise<{ success: boolean, user: object }>}
 */
export async function getMe(signal) {
  return api.get('/auth/me', { signal });
}

