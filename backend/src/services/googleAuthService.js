/**
 * Google OAuth service
 * Handles Google OAuth authorization URL generation, CSRF state management, and token/ID verification.
 */

const crypto = require('crypto');
const { getGoogleOAuthClient } = require('../config/googleAuth');
const OAuthState = require('../models/OAuthState');
const config = require('../config');

/**
 * Generate a cryptographically secure, short-lived OAuth state and save it in MongoDB.
 * @returns {Promise<{state: string, expiresAt: Date}>}
 */
const generateOAuthState = async () => {
  const state = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes lifespan

  await OAuthState.create({
    state,
    expiresAt,
  });

  return { state, expiresAt };
};

/**
 * Validates the OAuth state parameter against the session cookie and MongoDB record:
 * - Ensures state parameter exists in both query and cookie
 * - Compares values using a timing-safe comparison
 * - Atomically deletes record from MongoDB to enforce single-use
 * - Verifies state has not expired
 *
 * @param {string} queryState - State value returned by Google in query string.
 * @param {string} cookieState - State value stored in the browser's HttpOnly cookie.
 * @returns {Promise<boolean>}
 */
const validateOAuthState = async (queryState, cookieState) => {
  if (!queryState || typeof queryState !== 'string') {
    const error = new Error('Missing or invalid OAuth state parameter from provider');
    error.statusCode = 400;
    throw error;
  }

  if (!cookieState || typeof cookieState !== 'string') {
    const error = new Error('Missing OAuth session cookie. Cross-site request or expired session.');
    error.statusCode = 400;
    throw error;
  }

  const queryBuffer = Buffer.from(queryState);
  const cookieBuffer = Buffer.from(cookieState);

  if (queryBuffer.length !== cookieBuffer.length) {
    const error = new Error('OAuth state mismatch');
    error.statusCode = 400;
    throw error;
  }

  const isMatch = crypto.timingSafeEqual(queryBuffer, cookieBuffer);
  if (!isMatch) {
    const error = new Error('OAuth state mismatch. Request may have been tampered with or CSRF attempted.');
    error.statusCode = 400;
    throw error;
  }

  // Atomically consume state record to enforce single-use
  const stateRecord = await OAuthState.findOneAndDelete({ state: queryState });
  if (!stateRecord) {
    const error = new Error('OAuth state is invalid, expired, or has already been used');
    error.statusCode = 400;
    throw error;
  }

  if (stateRecord.expiresAt < new Date()) {
    const error = new Error('OAuth state has expired. Please restart the login process');
    error.statusCode = 400;
    throw error;
  }

  return true;
};

/**
 * Generate Google OAuth authorization URL with CSRF state parameter.
 * Requests openid, email, and profile scopes.
 *
 * @param {string} state - Cryptographically random state token.
 * @returns {string} Google authorization URL.
 */
const getAuthorizationUrl = (state) => {
  const client = getGoogleOAuthClient();

  const scopes = [
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
  ];

  const authUrlOptions = {
    access_type: 'offline',
    prompt: 'consent',
    scope: scopes,
  };

  if (state) {
    authUrlOptions.state = state;
  }

  return client.generateAuthUrl(authUrlOptions);
};

/**
 * Exchange Google authorization code for tokens and verify the ID token.
 * Validates that the Google email is verified.
 *
 * @param {string} code - Google authorization code from OAuth callback.
 * @returns {Promise<Object>} Verified Google user profile data.
 */
const verifyGoogleCallback = async (code) => {
  if (!code || typeof code !== 'string') {
    const error = new Error('Valid Google authorization code is required');
    error.statusCode = 400;
    throw error;
  }

  const client = getGoogleOAuthClient();

  let tokens;
  try {
    const response = await client.getToken(code);
    tokens = response.tokens;
  } catch (err) {
    const error = new Error(`Failed to exchange Google authorization code: ${err.message || 'Invalid or expired code'}`);
    error.statusCode = 400;
    throw error;
  }

  if (!tokens || !tokens.id_token) {
    const error = new Error('Google did not return a valid ID token');
    error.statusCode = 400;
    throw error;
  }

  let payload;
  try {
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: config.googleClientId,
    });
    payload = ticket.getPayload();
  } catch (err) {
    const error = new Error(`Failed to verify Google ID token: ${err.message || 'Invalid token'}`);
    error.statusCode = 401;
    throw error;
  }

  if (!payload || !payload.sub || !payload.email) {
    const error = new Error('Incomplete user profile received from Google');
    error.statusCode = 400;
    throw error;
  }

  // Enforce email verification by Google
  if (payload.email_verified !== true) {
    const error = new Error('Google email address is not verified');
    error.statusCode = 400;
    throw error;
  }

  return {
    googleId: payload.sub,
    email: payload.email.toLowerCase().trim(),
    name: payload.name || null,
    profilePicture: payload.picture || null,
  };
};

module.exports = {
  generateOAuthState,
  validateOAuthState,
  getAuthorizationUrl,
  verifyGoogleCallback,
};
