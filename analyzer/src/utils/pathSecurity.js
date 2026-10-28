/**
 * Path Security & Sanitization Utility
 * Prevents directory traversal and excludes real secret files (.env) from analysis.
 */

const path = require('path');

// Whitelisted environment templates (safe for documentation/metadata extraction)
const ALLOWED_ENV_TEMPLATES = new Set([
  '.env.example',
  '.env.sample',
  '.env.template',
  '.env.dist',
  '.env.defaults',
  '.env.schema',
]);

/**
 * Validates and sanitizes a relative file path inside a repository.
 * Throws an error if path traversal or dangerous characters are detected.
 *
 * @param {string} rawPath - File path inside repository.
 * @returns {string} Normalized POSIX relative path.
 * @throws {Error} If path is unsafe or attempts traversal.
 */
const sanitizePath = (rawPath) => {
  if (!rawPath || typeof rawPath !== 'string') {
    throw new Error('File path must be a non-empty string.');
  }

  // Reject null byte injection
  if (rawPath.includes('\0')) {
    throw new Error('Null byte detected in file path.');
  }

  // Convert Windows backslashes to forward slashes
  let normalized = rawPath.replace(/\\/g, '/');

  // Strip leading slash or dot-slash
  normalized = normalized.replace(/^\/+/, '').replace(/^\.\/+/, '');

  // Normalize path segments
  const segments = normalized.split('/').filter(Boolean);

  // Check for directory traversal segments
  for (const segment of segments) {
    if (segment === '..' || segment === '.') {
      throw new Error(`Directory traversal attempt detected in path: "${rawPath}"`);
    }
  }

  // Rebuild clean relative POSIX path
  const sanitized = segments.join('/');

  if (!sanitized) {
    throw new Error('Sanitized path is empty.');
  }

  return sanitized;
};

/**
 * Checks if a file is an actual secret environment file that must be excluded from analysis.
 * Note: `.env.example` and `.env.sample` are permitted as documentation templates.
 *
 * @param {string} filePath - Sanitized file path.
 * @returns {boolean} True if the file is a sensitive .env file that must be excluded.
 */
const isExcludedSecretFile = (filePath) => {
  const fileName = path.basename(filePath).toLowerCase();

  // If it's explicitly an allowed template, it is NOT excluded
  if (ALLOWED_ENV_TEMPLATES.has(fileName)) {
    return false;
  }

  // Exclude actual .env files (e.g. .env, .env.local, .env.prod, .env.staging, .env.secret)
  if (fileName === '.env' || fileName.startsWith('.env.')) {
    return true;
  }

  return false;
};

module.exports = {
  sanitizePath,
  isExcludedSecretFile,
  ALLOWED_ENV_TEMPLATES,
};
