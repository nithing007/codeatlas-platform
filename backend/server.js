/**
 * Server entry point
 * Loads environment variables, connects to MongoDB, and starts the Express server.
 */

// Load environment variables first — before any other imports that read process.env
require('dotenv').config();

const app = require('./src/app');
const config = require('./src/config');
const connectDB = require('./src/config/db');

const startServer = async () => {
  // Connect to MongoDB
  await connectDB();

  // Start Express server
  app.listen(config.port, () => {
    console.log(`\n  CodeAtlas API running on http://localhost:${config.port}`);
    console.log(`  Environment: ${config.nodeEnv}`);
    console.log(`  Health check: http://localhost:${config.port}/api/health\n`);
  });
};

startServer();
