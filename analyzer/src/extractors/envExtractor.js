/**
 * Environment Variable Extractor
 *
 * Extracts environment variable references from JavaScript/TypeScript source files
 * and from .env.example / .env.sample template files.
 *
 * Detects:
 *   - process.env.VARIABLE_NAME
 *   - process.env['VARIABLE_NAME']
 *   - process.env["VARIABLE_NAME"]
 *
 * From .env.example files:
 *   - KEY=value  (extracts only the key name, never the value)
 *   - # KEY (commented out documented variables)
 *
 * Never reads actual .env secret files.
 */

const { normalizeEnvVarName } = require('../utils/factNormalizer');

// Match: process.env.VARIABLE_NAME
const PROC_ENV_DOT_PATTERN = /process\.env\.([A-Z_][A-Z0-9_]*)/gi;

// Match: process.env['VARIABLE'] or process.env["VARIABLE"]
const PROC_ENV_BRACKET_PATTERN = /process\.env\s*\[(['"])([A-Z_][A-Z0-9_]*)\1\]/gi;

// Match lines in .env template files: KEY= or KEY=VALUE (only the key is captured)
const ENV_TEMPLATE_LINE_PATTERN = /^([A-Z_][A-Z0-9_]*)\s*=/m;

// Match commented-out variable documentation in .env.example: # VARIABLE_NAME or # VARIABLE_NAME=
const ENV_COMMENT_PATTERN = /^#\s*([A-Z_][A-Z0-9_]*)\s*(?:=|$)/m;

/**
 * Extract environment variable references from JS/TS source content.
 *
 * @param {string} content - File content (untrusted text).
 * @param {string} filePath - Repository-relative path for attribution.
 * @returns {Array<Object>} Array of ENVIRONMENT_VARIABLE facts.
 */
const extractEnvVarsFromSource = (content, filePath) => {
  const facts = [];
  if (!content || typeof content !== 'string') return facts;

  const seen = new Map(); // name -> first line number (deduplicate per file)

  const lineOffsets = buildLineOffsets(content);

  // 1. process.env.NAME pattern
  PROC_ENV_DOT_PATTERN.lastIndex = 0;
  let match;
  while ((match = PROC_ENV_DOT_PATTERN.exec(content)) !== null) {
    const name = normalizeEnvVarName(match[1]);
    if (!name) continue;
    const line = getLineNumber(lineOffsets, match.index);
    if (!seen.has(name)) {
      seen.set(name, line);
      facts.push({
        type: 'ENVIRONMENT_VARIABLE',
        name,
        source: filePath,
        line,
      });
    }
  }

  // 2. process.env['NAME'] or process.env["NAME"] pattern
  PROC_ENV_BRACKET_PATTERN.lastIndex = 0;
  while ((match = PROC_ENV_BRACKET_PATTERN.exec(content)) !== null) {
    const name = normalizeEnvVarName(match[2]);
    if (!name) continue;
    const line = getLineNumber(lineOffsets, match.index);
    if (!seen.has(name)) {
      seen.set(name, line);
      facts.push({
        type: 'ENVIRONMENT_VARIABLE',
        name,
        source: filePath,
        line,
      });
    }
  }

  return facts;
};

/**
 * Extract documented environment variables from .env.example / .env.sample files.
 * Extracts ONLY the key names, never the values.
 *
 * @param {string} content - File content of a .env template file.
 * @param {string} filePath - Repository-relative path.
 * @returns {Array<Object>} Array of ENVIRONMENT_VARIABLE facts.
 */
const extractEnvVarsFromTemplate = (content, filePath) => {
  const facts = [];
  if (!content || typeof content !== 'string') return facts;

  const seen = new Set();
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNumber = i + 1;

    // Skip blank lines
    if (!line) continue;

    // Try: KEY=value
    const defMatch = ENV_TEMPLATE_LINE_PATTERN.exec(line);
    if (defMatch) {
      const name = normalizeEnvVarName(defMatch[1]);
      if (name && !seen.has(name)) {
        seen.add(name);
        facts.push({
          type: 'ENVIRONMENT_VARIABLE',
          name,
          source: filePath,
          line: lineNumber,
          fromTemplate: true,
        });
      }
      continue;
    }

    // Try: # KEY= (documented but commented out)
    const commentMatch = ENV_COMMENT_PATTERN.exec(line);
    if (commentMatch) {
      const name = normalizeEnvVarName(commentMatch[1]);
      if (name && !seen.has(name)) {
        seen.add(name);
        facts.push({
          type: 'ENVIRONMENT_VARIABLE',
          name,
          source: filePath,
          line: lineNumber,
          fromTemplate: true,
          commented: true,
        });
      }
    }
  }

  return facts;
};

// ---- Helpers ----

function buildLineOffsets(content) {
  const offsets = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') offsets.push(i + 1);
  }
  return offsets;
}

function getLineNumber(lineOffsets, charOffset) {
  let low = 0, high = lineOffsets.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (lineOffsets[mid] <= charOffset) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

module.exports = {
  extractEnvVarsFromSource,
  extractEnvVarsFromTemplate,
};
