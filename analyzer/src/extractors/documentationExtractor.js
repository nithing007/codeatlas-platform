/**
 * Documentation Extractor
 *
 * Extracts structured facts from Markdown documentation files:
 *   - Explicitly documented API endpoints
 *   - Explicitly referenced environment variable names
 *
 * Safety rules:
 *   - Only extracts what is explicitly written, never infers.
 *   - Skips external URLs (https://github.com, npmjs, etc.)
 *   - LICENSE files are excluded from environment variable extraction.
 *   - Env vars must appear in configuration context, not arbitrary prose.
 *   - Never executes code blocks, never evals content.
 *
 * Issue 2 fix: LICENSE files excluded from env var extraction.
 * Issue 5 fix: Env var extraction requires configuration context signals.
 */

const { normalizeMethod, normalizePath, normalizeEnvVarName } = require('../utils/factNormalizer');

// ── License file detection ──────────────────────────────────────────────────
// These filenames must never contribute environment variable facts.
// The ALL-CAPS legal prose in MIT/Apache/GPL licenses causes mass false positives.
const LICENSE_FILENAME_RE = /^license(\.md|\.txt|\.rst|\.html|\.adoc)?$/i;

function isLicenseFile(filePath) {
  const name = filePath.split('/').pop();
  return LICENSE_FILENAME_RE.test(name);
}

// ── API endpoint detection ──────────────────────────────────────────────────
const DOC_ENDPOINT_PATTERN =
  /\b(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(\/[\w/.:_\-{}*[\]?&=%]*)/gi;

const CURL_PATTERN =
  /curl\s+(?:-s\s+)?(?:-X\s+)?(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+https?:\/\/[^/\s]+(\/([\w/.:_\-{}*[\]?&=%]*))/gi;

const EXTERNAL_HOSTNAME_PATTERN =
  /https?:\/\/(?:github\.com|npmjs\.com|google\.com|stackoverflow\.com|docs\.|api\.github|raw\.githubusercontent)/i;

const NON_API_PATH_PREFIXES = ['//'];

// ── Environment variable detection ─────────────────────────────────────────
//
// Strategy (Issue 5 fix):
// Rather than matching any ALL_CAPS token, we require the token to appear in
// a context that strongly suggests it is a configuration variable:
//
//   Signal 1 — Backtick-quoted:   `VARIABLE_NAME`
//   Signal 2 — Assignment context: VARIABLE_NAME= or VARIABLE_NAME =
//   Signal 3 — process.env reference: process.env.VARIABLE_NAME
//   Signal 4 — Inline code span with assignment: `VARIABLE_NAME=value`
//   Signal 5 — Table cell with _ (env vars almost always contain underscores)
//              or are explicitly formatted as a config table row
//
// This approach avoids matching arbitrary ALL-CAPS prose words in paragraphs.

// Pattern 1: Backtick-quoted ALL_CAPS token with optional underscore
// Matches: `JWT_SECRET`, `PORT`, `MONGODB_URI`
const ENV_BACKTICK_PATTERN = /`([A-Z][A-Z0-9_]{2,})`/g;

// Pattern 2: process.env.NAME in documentation code blocks
const ENV_PROC_ENV_PATTERN = /process\.env\.([A-Z_][A-Z0-9_]*)/g;

// Pattern 3: KEY= assignment in documentation (code blocks or .env examples)
// Matches lines that look like: KEY=value or KEY = value
// Only matches if the KEY contains at least one underscore OR is all-caps 4+ chars
const ENV_ASSIGNMENT_PATTERN = /^([A-Z][A-Z0-9_]{2,})\s*=/m;

// Pattern 4: Table rows — Markdown table cell starting with all-caps name
// e.g.: | JWT_SECRET | Description | or | PORT | 3000 |
// Uses lookahead (?=\|) so multiple columns in the same row can be matched
const ENV_TABLE_CELL_PATTERN = /\|\s*([A-Z][A-Z0-9_]{2,})\s*(?=\|)/g;

// Detects table header rows specifically for configuration/environment tables
const CONFIG_TABLE_HEADER_RE =
  /\|\s*(?:env(?:ironment)?\s*var(?:iable)?s?|var(?:iable)?s?|config(?:uration)?|parameters?|keys?|settings?)\b/i;

// Well-known runtime/system variables that should never generate findings
// (Issue 4 fix — see also envExtractor.js)
const SYSTEM_ENV_SKIP = new Set([
  'NODE_ENV', 'PATH', 'HOME', 'PWD', 'SHELL', 'USER', 'TMPDIR', 'TEMP', 'TMP',
  'LANG', 'TERM', 'EDITOR', 'PAGER', 'LOGNAME', 'HOSTNAME', 'DISPLAY',
]);

// Skip tokens that are definitely not env var names
// (HTTP methods, common acronyms, legal/English words, HTTP status names)
const ALWAYS_SKIP = new Set([
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD',
  'HTTP', 'HTTPS', 'URL', 'API', 'JSON', 'XML', 'HTML', 'SQL', 'CSS',
  'TRUE', 'FALSE', 'NULL', 'EOF', 'OK', 'ID', 'UUID', 'URI',
  'CORS', 'JWT', 'OTP', 'AWS', 'GCP', 'YAML', 'TOML', 'ENV',
  'README', 'CHANGELOG', 'LICENSE', 'CONTRIBUTING',
  // Legal/MIT prose words that kept slipping through
  'THE', 'AND', 'NOT', 'BUT', 'FOR', 'OUT', 'USE', 'WITH',
  'FROM', 'INTO', 'THAN', 'THEN', 'THIS', 'THAT',
  'ANY', 'ALL', 'ITS', 'ARE', 'HAS', 'HAD', 'WAS', 'BEEN',
  // Common doc/tech acronyms not env vars
  'REST', 'SOAP', 'GRPC', 'RPC', 'SDK', 'CLI', 'GUI',
  'IDE', 'ESL', 'MIT', 'SMTP', 'POP', 'IMAP', 'PM',
  'SSL', 'TLS', 'SSH', 'GPG', 'RSA', 'AES', 'SHA',
  'NODE', 'NPM', 'GIT', 'EOL', 'NAN',
  // HTTP status code constant names (appear in error code tables in README)
  'NOT_FOUND', 'UNAUTHORIZED', 'FORBIDDEN', 'BAD_REQUEST', 'CONFLICT',
  'CREATED', 'ACCEPTED', 'NO_CONTENT', 'MOVED_PERMANENTLY', 'FOUND',
  'INTERNAL_SERVER_ERROR', 'NOT_IMPLEMENTED', 'GATEWAY_TIMEOUT',
  'UNPROCESSABLE_ENTITY', 'TOO_MANY_REQUESTS', 'SERVICE_UNAVAILABLE',
]);

// Heading patterns that indicate we are inside a configuration/environment-variable section.
// When a matching heading is encountered, table cells become STRONG signals.
const CONFIG_HEADING_RE =
  /^#{1,4}\s+(environment\s+variable|env(ironment)?\s+var|configuration|config|settings?|setup|environment)/i;
const ANY_HEADING_RE = /^#{1,4}\s+/;

/**
 * Extracts documented API endpoints and environment variable references from
 * a Markdown (or plain text) documentation file.
 *
 * LICENSE files are excluded from environment variable extraction.
 *
 * @param {string} content - File content.
 * @param {string} filePath - Repository-relative path.
 * @returns {{ apiEndpoints: Array<Object>, environmentVariables: Array<Object>, warnings: Array<string> }}
 */
const extractFromDocumentation = (content, filePath) => {
  const apiEndpoints = [];
  const environmentVariables = [];
  const warnings = [];

  if (!content || typeof content !== 'string') {
    return { apiEndpoints, environmentVariables, warnings };
  }

  // LICENSE files: extract API endpoints normally but skip env var extraction entirely
  const skipEnvVars = isLicenseFile(filePath);

  const seenEndpoints = new Set();
  const seenEnvVars = new Set();

  const lines = content.split('\n');

  // Issue 3 fix: Track whether we are inside a configuration/environment section.
  // Markdown headings like "## Environment Variables" or "## Configuration" upgrade
  // Issue 3 fix: Track whether we are inside a configuration/environment section
  // or a configuration table. Headings like "## Environment Variables" or table
  // headers like "| Environment Variable |" upgrade table-cell and assignment signals
  // to STRONG, allowing short tokens like PORT to be extracted.
  let inConfigSection = false;
  let inConfigTable = false;
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    // Track fenced code blocks (lines starting with # inside code blocks are comments, not headings)
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
    }

    // Track config-section headings (only outside code blocks)
    if (!inCodeBlock && ANY_HEADING_RE.test(line)) {
      inConfigSection = CONFIG_HEADING_RE.test(line);
      inConfigTable = false;
    }

    // Track config tables: entering/exiting markdown tables
    if (line.trim().startsWith('|')) {
      if (CONFIG_TABLE_HEADER_RE.test(line)) {
        inConfigTable = true;
      }
    } else {
      inConfigTable = false;
    }

    const hasExternalUrl = EXTERNAL_HOSTNAME_PATTERN.test(line);

    // 1. Extract documented endpoints: METHOD /path
    if (!hasExternalUrl) {
      DOC_ENDPOINT_PATTERN.lastIndex = 0;
      let match;
      while ((match = DOC_ENDPOINT_PATTERN.exec(line)) !== null) {
        const method = normalizeMethod(match[1]);
        const rawPath = match[2];

        if (NON_API_PATH_PREFIXES.some((p) => rawPath.startsWith(p))) continue;

        const epPath = normalizePath(rawPath);
        const key = `${method}:${epPath}`;

        if (!seenEndpoints.has(key)) {
          seenEndpoints.add(key);
          apiEndpoints.push({
            type: 'API_ENDPOINT',
            source: filePath,
            method,
            path: epPath,
            line: lineNumber,
            fromDocumentation: true,
          });
        }
      }
    }

    // 2. Extract curl examples
    CURL_PATTERN.lastIndex = 0;
    let curlMatch;
    while ((curlMatch = CURL_PATTERN.exec(line)) !== null) {
      const method = normalizeMethod(curlMatch[1]);
      const rawPath = curlMatch[2];
      const epPath = normalizePath(rawPath);

      if (!epPath.startsWith('/')) continue;

      const key = `${method}:${epPath}`;
      if (!seenEndpoints.has(key)) {
        seenEndpoints.add(key);
        apiEndpoints.push({
          type: 'API_ENDPOINT',
          source: filePath,
          method,
          path: epPath,
          line: lineNumber,
          fromDocumentation: true,
          fromCurl: true,
        });
      }
    }

    // 3. Extract environment variables — skip entirely for LICENSE files
    if (skipEnvVars) continue;

    const isConfigContext = inConfigSection || inConfigTable;
    collectEnvVarsFromLine(line, lineNumber, filePath, seenEnvVars, environmentVariables, isConfigContext);
  }

  return { apiEndpoints, environmentVariables, warnings };
};

/**
 * Extracts environment variable names from a single documentation line
 * using context-sensitive heuristics.
 *
 * Signal strength:
 *   STRONG — accept any length ≥ 3:
 *     - Backtick-quoted: `VARIABLE_NAME`
 *     - process.env reference
 *     - KEY= assignment inside a config section or table
 *     - Table cell inside a config section or table
 *   WEAK — require underscore OR length ≥ 5:
 *     - KEY= assignment syntax outside config section
 *     - Table cell outside a config section/table
 *
 * @param {string}  line
 * @param {number}  lineNumber
 * @param {string}  filePath
 * @param {Set}     seenEnvVars
 * @param {Array}   environmentVariables
 * @param {boolean} isConfigContext - true when under config heading or table
 * @private
 */
function collectEnvVarsFromLine(line, lineNumber, filePath, seenEnvVars, environmentVariables, isConfigContext = false) {
  const candidates = [];

  // Signal 1: backtick-quoted (strong — accept any length ≥ 3)
  ENV_BACKTICK_PATTERN.lastIndex = 0;
  let m;
  while ((m = ENV_BACKTICK_PATTERN.exec(line)) !== null) {
    candidates.push({ name: m[1], strong: true });
  }

  // Signal 2: process.env.NAME (strong)
  ENV_PROC_ENV_PATTERN.lastIndex = 0;
  while ((m = ENV_PROC_ENV_PATTERN.exec(line)) !== null) {
    candidates.push({ name: m[1], strong: true });
  }

  // Signal 3: KEY= assignment (strong in config context, weak otherwise)
  const assignMatch = ENV_ASSIGNMENT_PATTERN.exec(line.trim());
  if (assignMatch) {
    candidates.push({ name: assignMatch[1], strong: isConfigContext });
  }

  // Signal 4: Markdown table cell
  // STRONG when inside a config section or config table (e.g. | PORT | Application port |)
  // WEAK otherwise — prevents extraction from HTTP error code tables, etc.
  ENV_TABLE_CELL_PATTERN.lastIndex = 0;
  while ((m = ENV_TABLE_CELL_PATTERN.exec(line)) !== null) {
    candidates.push({ name: m[1], strong: isConfigContext });
  }

  // Filter and emit
  for (const { name: raw, strong } of candidates) {
    const name = normalizeEnvVarName(raw);
    if (!name || name.length < 3) continue;
    if (!/^[A-Z][A-Z0-9_]+$/.test(name)) continue;
    if (ALWAYS_SKIP.has(name)) continue;
    if (SYSTEM_ENV_SKIP.has(name)) continue;

    // Weak signals: require underscore OR length ≥ 5 to filter short acronyms
    // Strong signals (backtick, process.env, in-config table): accept length ≥ 3
    if (!strong) {
      const hasUnderscore = name.includes('_');
      if (!hasUnderscore && name.length < 5) continue;
    }

    if (!seenEnvVars.has(name)) {
      seenEnvVars.add(name);
      environmentVariables.push({
        type: 'ENVIRONMENT_VARIABLE',
        name,
        source: filePath,
        line: lineNumber,
        fromDocumentation: true,
      });
    }
  }
}


module.exports = {
  extractFromDocumentation,
};
