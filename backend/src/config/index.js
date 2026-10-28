/**
 * Application configuration
 * Centralizes all environment variables with defaults.
 */

const config = {
  port: parseInt(process.env.PORT, 10) || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/codeatlas',
  jwtSecret: process.env.JWT_SECRET || 'default_dev_secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  otpExpiresMinutes: parseInt(process.env.OTP_EXPIRES_MINUTES, 10) || 5,
  otpMaxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS, 10) || 5,
  otpResendCooldownSeconds: parseInt(process.env.OTP_RESEND_COOLDOWN_SECONDS, 10) || 60,
  googleClientId: (process.env.GOOGLE_CLIENT_ID || '').trim(),
  googleClientSecret: (process.env.GOOGLE_CLIENT_SECRET || '').trim(),
  googleCallbackUrl: (process.env.GOOGLE_CALLBACK_URL || 'http://localhost:5000/api/auth/google/callback').trim(),
  authCookieName: process.env.AUTH_COOKIE_NAME || 'codeatlas_auth',
  authCookieMaxAge: parseInt(process.env.AUTH_COOKIE_MAX_AGE, 10) || 7 * 24 * 60 * 60 * 1000, // 7 days in ms
  analyzerUrl: (process.env.ANALYZER_URL || 'http://localhost:6001').replace(/\/$/, ''),
  analyzerInternalToken: process.env.ANALYZER_INTERNAL_TOKEN || '',
  analyzerTimeoutMs: parseInt(process.env.ANALYZER_TIMEOUT_MS, 10) || 120000, // 2 minutes default
};

module.exports = config;
