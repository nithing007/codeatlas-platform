/**
 * Global error-handling middleware
 * Catches all errors passed via next(err) and returns a consistent JSON response.
 *
 * Response shape:
 *   Standard:   { success: false, error: "message" }
 *   With code:  { success: false, error: { code: "ERROR_CODE", message: "message" } }
 */

const config = require('../config');

const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  console.error(`[ERROR] ${statusCode} - ${message}`);
  if (config.nodeEnv === 'development') {
    console.error(err.stack);
  }

  // If the error carries a machine-readable code, use structured format.
  // Otherwise fall back to the plain string format for backward compatibility.
  const errorBody = err.code
    ? { code: err.code, message }
    : message;

  res.status(statusCode).json({
    success: false,
    error: errorBody,
    ...(config.nodeEnv === 'development' && { stack: err.stack }),
  });
};

module.exports = errorHandler;
