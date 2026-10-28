/**
 * Binary File Detector Utility
 * Identifies binary and compiled files to skip unnecessary text parsing.
 */

const path = require('path');

const BINARY_EXTENSIONS = new Set([
  // Images
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.bmp', '.tiff', '.tif', '.psd', '.ai',
  // Audio & Video
  '.mp3', '.mp4', '.wav', '.ogg', '.m4a', '.flac', '.avi', '.mov', '.mkv', '.webm', '.flv',
  // Archives & Compressed
  '.zip', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.rar', '.iso', '.dmg',
  // Compiled & Executables
  '.exe', '.dll', '.so', '.dylib', '.class', '.jar', '.war', '.ear',
  '.pyc', '.pyo', '.pyd', '.o', '.obj', '.a', '.lib', '.wasm', '.bin',
  // Fonts
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  // Documents & Media formats
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  // Database files
  '.db', '.sqlite', '.sqlite3', '.mdb',
]);

/**
 * Checks if a file is binary based on its file extension.
 *
 * @param {string} filePath - Path or filename to check.
 * @returns {boolean} True if the file has a known binary extension.
 */
const isBinaryExtension = (filePath) => {
  if (!filePath || typeof filePath !== 'string') return false;
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
};

/**
 * Inspects buffer content for null bytes (heuristic for binary data).
 *
 * @param {Buffer|string} content - First chunk of file content.
 * @returns {boolean} True if binary null bytes are detected.
 */
const isBinaryContent = (content) => {
  if (!content) return false;
  if (Buffer.isBuffer(content)) {
    // Check first 1024 bytes for null character
    const checkLength = Math.min(content.length, 1024);
    for (let i = 0; i < checkLength; i++) {
      if (content[i] === 0) return true;
    }
    return false;
  }
  if (typeof content === 'string') {
    return content.slice(0, 1024).includes('\0');
  }
  return false;
};

module.exports = {
  isBinaryExtension,
  isBinaryContent,
  BINARY_EXTENSIONS,
};
