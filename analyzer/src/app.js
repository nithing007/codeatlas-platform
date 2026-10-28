/**
 * Analyzer HTTP Application
 *
 * Configures the Express application for the CodeAtlas Analyzer service.
 * Exported separately from server.js so it can be imported in tests
 * without starting the network listener.
 *
 * This application does NOT:
 * - Connect to MongoDB
 * - Handle user authentication (JWT / OAuth / OTP)
 * - Import repository models
 * - Expose secrets or environment variable values
 */

const express = require('express');
const analysisRouter = require('./routes/analysisRoutes');

const app = express();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// Parse JSON request bodies
app.use(express.json());

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Mount analysis routes under /api prefix
app.use('/api', analysisRouter);

// ---------------------------------------------------------------------------
// 404 catch-all
// ---------------------------------------------------------------------------

app.use((req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.originalUrl} not found.`,
    },
  });
});

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // Never expose stack traces, file paths, or internal details in responses.
  console.error('[analyzer] Unhandled error:', err.message);

  res.status(err.statusCode || 500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
    },
  });
});

module.exports = app;
