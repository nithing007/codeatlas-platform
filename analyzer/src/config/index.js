/**
 * Analyzer Service Configuration
 */

require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT, 10) || 6001,
  maxFileSizeBytes: parseInt(process.env.MAX_FILE_SIZE_BYTES, 10) || 512 * 1024, // 512 KB default limit
  maxTotalFiles: parseInt(process.env.MAX_TOTAL_FILES, 10) || 5000,
  githubApiTimeoutMs: parseInt(process.env.GITHUB_API_TIMEOUT_MS, 10) || 15000,
  analyzerInternalToken: process.env.ANALYZER_INTERNAL_TOKEN || '',
};

module.exports = config;
