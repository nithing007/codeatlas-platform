/**
 * Google OAuth configuration
 * Initializes Google OAuth2Client using environment variables.
 */

const { OAuth2Client } = require('google-auth-library');
const config = require('./index');

/**
 * Returns a configured Google OAuth2Client instance.
 * Throws a descriptive error if required OAuth credentials are missing.
 */
const getGoogleOAuthClient = () => {
  if (!config.googleClientId || !config.googleClientSecret) {
    const error = new Error('Google OAuth is not properly configured. Missing client ID or client secret.');
    error.statusCode = 500;
    throw error;
  }

  return new OAuth2Client(
    config.googleClientId,
    config.googleClientSecret,
    config.googleCallbackUrl
  );
};

module.exports = { getGoogleOAuthClient };
