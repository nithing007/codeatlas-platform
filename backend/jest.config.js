/**
 * Jest Configuration for CodeAtlas Backend
 */

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  verbose: true,
  clearMocks: true,
  forceExit: true,
  testTimeout: 20000,
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/config/**',
    '!src/server.js',
  ],
  coverageReporters: ['text', 'lcov', 'clover'],
};
