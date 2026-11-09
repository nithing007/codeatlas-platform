/**
 * Test Database Helper
 *
 * Enforces strict database isolation for integration tests.
 * ONLY permits connections and cleanup operations against 'codeatlas_test'.
 * NEVER falls back to or touches the development/production database.
 */

const mongoose = require('mongoose');

const TEST_DB_NAME = 'codeatlas_test';
const TEST_MONGODB_URI = process.env.TEST_MONGODB_URI || 'mongodb://localhost:27017/codeatlas_test';

/**
 * Validates that a URI or connection strictly points to the test database.
 * @param {string} uri
 */
function assertTestDbUri(uri) {
  const url = new URL(uri.replace(/^mongodb:\/\//, 'http://'));
  const dbName = url.pathname.replace(/^\//, '');
  if (dbName !== TEST_DB_NAME) {
    throw new Error(
      `FATAL SAFETY VIOLATION: Test suite attempted to connect to database '${dbName}'. Tests MUST ONLY connect to '${TEST_DB_NAME}'.`
    );
  }
}

/**
 * Validates active mongoose connection is to the test database.
 */
function assertActiveTestConnection() {
  if (!mongoose.connection || mongoose.connection.readyState !== 1) {
    throw new Error('No active database connection.');
  }
  const dbName = mongoose.connection.name;
  if (dbName !== TEST_DB_NAME) {
    throw new Error(
      `FATAL SAFETY VIOLATION: Active database connection is '${dbName}', expected '${TEST_DB_NAME}'. Aborting operation.`
    );
  }
}

/**
 * Connects to the isolated test database.
 */
async function connectTestDb() {
  assertTestDbUri(TEST_MONGODB_URI);

  if (mongoose.connection.readyState === 1) {
    assertActiveTestConnection();
    return;
  }

  // Force environment to test
  process.env.NODE_ENV = 'test';
  process.env.MONGODB_URI = TEST_MONGODB_URI;

  await mongoose.connect(TEST_MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
  });

  assertActiveTestConnection();
}

/**
 * Cleans collections in the test database.
 * Strict safety check: will refuse to run if connected to any DB other than 'codeatlas_test'.
 */
async function cleanTestDb() {
  assertActiveTestConnection();

  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
}

/**
 * Disconnects from the test database.
 */
async function disconnectTestDb() {
  if (mongoose.connection.readyState !== 0) {
    assertActiveTestConnection();
    await mongoose.disconnect();
  }
}

module.exports = {
  TEST_DB_NAME,
  TEST_MONGODB_URI,
  connectTestDb,
  cleanTestDb,
  disconnectTestDb,
  assertActiveTestConnection,
};

