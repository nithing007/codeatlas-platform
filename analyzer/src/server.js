/**
 * Analyzer Server Entry Point
 *
 * Loads environment variables and starts the CodeAtlas Analyzer HTTP service.
 * This is the production entry point — tests import src/app.js directly.
 */

// Load environment variables first
require('dotenv').config();

const app = require('./app');
const config = require('./config');

const port = config.port;

app.listen(port, () => {
  console.log(`\n  CodeAtlas Analyzer running on http://localhost:${port}`);
  console.log(`  Health check: http://localhost:${port}/api/health\n`);
});
