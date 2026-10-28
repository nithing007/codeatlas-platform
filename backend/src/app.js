/**
 * Express application setup
 * Configures middleware, routes, and error handling.
 * Exported separately from server.js so it can be imported in tests without starting the server.
 */

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const config = require('./config');
const errorHandler = require('./middleware/errorHandler');
const healthRouter = require('./routes/health');
const authRouter = require('./routes/authRoutes');
const adminRouter = require('./routes/adminRoutes');
const repositoryRouter = require('./routes/repositoryRoutes');

const app = express();

// --------------- Middleware ---------------

// Parse JSON request bodies
app.use(express.json());

// Parse URL-encoded request bodies
app.use(express.urlencoded({ extended: true }));

// Parse Cookie headers
app.use(cookieParser());

// Enable CORS
app.use(
  cors({
    origin: config.clientUrl,
    credentials: true,
  })
);

// --------------- Routes ---------------

// Health check
app.use('/api/health', healthRouter);

// Authentication
app.use('/api/auth', authRouter);

// Administration (Role-protected)
app.use('/api/admin', adminRouter);

// Repositories (Public intake & management)
app.use('/api/repositories', repositoryRouter);

// Catch-all for undefined routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route ${req.method} ${req.originalUrl} not found`,
  });
});

// --------------- Error Handling ---------------

app.use(errorHandler);

module.exports = app;
