/**
 * Server entry point
 * Loads environment variables, connects to MongoDB, and starts the Express server.
 */

// Load environment variables first — before any other imports that read process.env
require('dotenv').config();

const app = require('./src/app');
const config = require('./src/config');
const connectDB = require('./src/config/db');
const emailService = require('./src/services/emailService');

const startServer = async () => {
  try {
    // Validate critical production environment configuration
    if (config.nodeEnv === 'production') {
      if (!config.jwtSecret || config.jwtSecret === 'default_dev_secret') {
        throw new Error('FATAL SECURITY ERROR: JWT_SECRET must be explicitly configured in production mode.');
      }
    }

    // Connect to MongoDB
    await connectDB();

    // Verify Email SMTP transporter configuration (non-blocking diagnostics)
    await emailService.verifyTransporterConnection().catch((err) => {
      console.error(`  [EMAIL] Startup verification check failed: ${err.message}`);
    });

    // Start Express server
    const server = app.listen(config.port, () => {
      console.log(`\n  CodeAtlas API running on http://localhost:${config.port}`);
      console.log(`  Environment: ${config.nodeEnv}`);
      console.log(`  Health check: http://localhost:${config.port}/api/health\n`);
    });

    return server;
  } catch (err) {
    console.error(`[server] Startup failed: ${err.message}`);
    process.exit(1);
  }
};

startServer();
