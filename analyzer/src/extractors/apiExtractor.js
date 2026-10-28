/**
 * Express API Extractor
 *
 * Extracts API endpoint facts from JavaScript/TypeScript source files using
 * regex-based static pattern matching. Never executes repository code.
 *
 * Detects:
 *   - app.get/post/put/patch/delete/options/head(...)
 *   - router.get/post/put/patch/delete/options/head(...)
 *   - Router mounting: anyVar.use('/prefix', routerVar)
 *
 * Multi-level prefix resolution:
 *   Resolves chains such as:
 *     app.use('/v1', v1Router)
 *     v1Router.use('/auth', authRouter)
 *     authRouter.post('/login')
 *   → produces POST /v1/auth/login
 *
 * Returns structured API_ENDPOINT facts.
 */

const { normalizeMethod, normalizePath } = require('../utils/factNormalizer');

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];

// Match: (app|router|anyVar).METHOD('path' or "path" or `path`, ...)
const ROUTE_PATTERN = new RegExp(
  `(\\w+)\\.(${HTTP_METHODS.join('|')})\\s*\\(\\s*(['"\`])([^'"\`]*?)\\3`,
  'gi'
);

// Match: (router|app|anyVar).route('path')
const ROUTE_CHAIN_ROOT_PATTERN =
  /(\w+)\s*\.\s*route\s*\(\s*(['"`])([^'"`]*?)\2\s*\)/gi;

// Match chained method calls on a route: .get(, .post(, etc.
const METHOD_CHAIN_CALL_PATTERN = new RegExp(
  `\\.\\s*(${HTTP_METHODS.join('|')})\\s*\\(`,
  'gi'
);

// Match route objects in array tables: { path: '/auth', route: authRoute }
const ROUTE_TABLE_OBJECT_PATTERN =
  /\{\s*(?:path\s*:\s*(['"`])([^'"`]+?)\1\s*,\s*route\s*:\s*(\w+)|route\s*:\s*(\w+)\s*,\s*path\s*:\s*(['"`])([^'"`]+?)\5)\s*,?\s*\}/gi;

// Match: (app|anyVar).use('path', routerVar)
const USE_PATTERN =
  /(\w+)\.use\s*\(\s*(['"`])([^'"`]*?)\2\s*,\s*(\w+)\s*\)/gi;

const FOREACH_ROUTER_USE_PATTERN =
  /(\w+)\s*\.\s*use\s*\(\s*\w+\.path\s*,\s*\w+\.route\s*\)/i;

/**
 * Extracts Express route definitions from JS/TS source content.
 *
 * @param {string} content - File content to analyze (treated as untrusted text).
 * @param {string} filePath - Repository-relative file path for source attribution.
 * @returns {{ endpoints: Array<Object>, mountedPrefixes: Array<Object> }}
 */
const extractApiEndpoints = (content, filePath) => {
  const endpoints = [];
  const mountedPrefixes = [];

  if (!content || typeof content !== 'string') {
    return { endpoints, mountedPrefixes };
  }

  const lineOffsets = buildLineOffsets(content);
  const seenEndpoints = new Set();

  // 1. Extract route handler registrations: app.get('/path', ...)
  ROUTE_PATTERN.lastIndex = 0;
  let match;
  while ((match = ROUTE_PATTERN.exec(content)) !== null) {
    const [, objectName, method, , routePath] = match;
    const lineNumber = getLineNumber(lineOffsets, match.index);
    const normalizedMethod = normalizeMethod(method);
    const normalizedPath = normalizePath(routePath);

    // Issue 2 fix: Filter blanket CORS/preflight wildcard OPTIONS handlers.
    // Patterns like app.options('*', cors()) or app.options('/*', cors())
    // are infrastructure routes, not user-facing API endpoints.
    // Only explicit paths (e.g. app.options('/api/upload', ...)) are kept.
    if (normalizedMethod === 'OPTIONS' && isWildcardPath(normalizedPath)) {
      continue;
    }

    const key = `${objectName}:${normalizedMethod}:${normalizedPath}:${lineNumber}`;
    if (!seenEndpoints.has(key)) {
      seenEndpoints.add(key);
      endpoints.push({
        type: 'API_ENDPOINT',
        source: filePath,
        objectName,
        method: normalizedMethod,
        path: normalizedPath,
        line: lineNumber,
        prefixResolved: false,
      });
    }
  }

  // 2. Extract chained route definitions: router.route('/path').get(...).post(...)
  ROUTE_CHAIN_ROOT_PATTERN.lastIndex = 0;
  let chainMatch;
  while ((chainMatch = ROUTE_CHAIN_ROOT_PATTERN.exec(content)) !== null) {
    const [, objectName, , routePath] = chainMatch;
    const chainStart = ROUTE_CHAIN_ROOT_PATTERN.lastIndex;
    const normalizedPath = normalizePath(routePath);

    // Find statement boundary (semicolon or next top-level statement)
    const rest = content.slice(chainStart);
    const endBoundary = rest.search(/;|\b(?:router|app|const|let|var|module|export)\b/);
    const chainText = endBoundary !== -1 ? rest.slice(0, endBoundary) : rest.slice(0, 1000);

    METHOD_CHAIN_CALL_PATTERN.lastIndex = 0;
    let methodMatch;
    while ((methodMatch = METHOD_CHAIN_CALL_PATTERN.exec(chainText)) !== null) {
      const method = methodMatch[1];
      const normalizedMethod = normalizeMethod(method);
      const matchIndexInContent = chainStart + methodMatch.index;
      const lineNumber = getLineNumber(lineOffsets, matchIndexInContent);

      if (normalizedMethod === 'OPTIONS' && isWildcardPath(normalizedPath)) {
        continue;
      }

      const key = `${objectName}:${normalizedMethod}:${normalizedPath}:${lineNumber}`;
      if (!seenEndpoints.has(key)) {
        seenEndpoints.add(key);
        endpoints.push({
          type: 'API_ENDPOINT',
          source: filePath,
          objectName,
          method: normalizedMethod,
          path: normalizedPath,
          line: lineNumber,
          prefixResolved: false,
        });
      }
    }
  }

  const seenMounts = new Set();

  // 3. Extract direct app.use() prefix mounts: app.use('/prefix', routerVar)
  USE_PATTERN.lastIndex = 0;
  while ((match = USE_PATTERN.exec(content)) !== null) {
    const [, objectName, , prefix, routerVar] = match;
    const lineNumber = getLineNumber(lineOffsets, match.index);
    const normPrefix = normalizePath(prefix);
    const key = `${objectName}:${normPrefix}:${routerVar}`;

    if (!seenMounts.has(key)) {
      seenMounts.add(key);
      mountedPrefixes.push({
        objectName,
        prefix: normPrefix,
        routerVar,
        source: filePath,
        line: lineNumber,
      });
    }
  }

  // 4. Extract route table arrays: [{ path: '/auth', route: authRoute }]
  ROUTE_TABLE_OBJECT_PATTERN.lastIndex = 0;
  let tableMatch;
  let targetRouterVar = null;

  while ((tableMatch = ROUTE_TABLE_OBJECT_PATTERN.exec(content)) !== null) {
    const rawPrefix = tableMatch[2] || tableMatch[6];
    const routerVar = tableMatch[3] || tableMatch[4];
    if (!rawPrefix || !routerVar) continue;

    if (!targetRouterVar) {
      const foreachM = FOREACH_ROUTER_USE_PATTERN.exec(content);
      if (foreachM) {
        targetRouterVar = foreachM[1];
      } else {
        const expM = /module\.exports\s*=\s*(\w+)|export\s+default\s+(\w+)/.exec(content);
        targetRouterVar = expM ? (expM[1] || expM[2]) : 'router';
      }
    }

    const lineNumber = getLineNumber(lineOffsets, tableMatch.index);
    const normPrefix = normalizePath(rawPrefix);
    const key = `${targetRouterVar}:${normPrefix}:${routerVar}`;

    if (!seenMounts.has(key)) {
      seenMounts.add(key);
      mountedPrefixes.push({
        objectName: targetRouterVar,
        prefix: normPrefix,
        routerVar,
        source: filePath,
        line: lineNumber,
      });
    }
  }

  return { endpoints, mountedPrefixes };
};

/**
 * Applies router prefix mounts to resolve full route paths deterministically
 * across multiple nesting levels.
 *
 * Algorithm:
 *   1. Build a directed graph: routerVar → { prefix, parentVar }.
 *      Each mount record says: "parentVar.use('/prefix', routerVar)"
 *   2. For each endpoint's objectName, walk up the graph to accumulate
 *      all ancestor prefixes in order (root → leaf).
 *   3. Cycle detection with a visited set per walk prevents infinite loops.
 *   4. Conservatively keeps unresolved routes if a chain cannot be determined.
 *
 * Maximum walk depth: 10 levels (protection against pathological inputs).
 *
 * @param {Array<Object>} endpoints - All extracted API endpoints.
 * @param {Array<Object>} mountedPrefixes - All detected .use() mounts.
 * @returns {Array<Object>} Endpoints with resolved full paths where deterministic.
 */
const resolvePrefixes = (endpoints, mountedPrefixes) => {
  if (!mountedPrefixes || mountedPrefixes.length === 0) return endpoints;

  // Build mount graph: routerVar -> { prefix, parentVar }
  // If a var is mounted multiple times by different parents, keep first deterministic mount.
  const mountGraph = new Map(); // routerVar -> { prefix, parentVar }
  for (const mount of mountedPrefixes) {
    if (!mountGraph.has(mount.routerVar)) {
      mountGraph.set(mount.routerVar, {
        prefix: mount.prefix,
        parentVar: mount.objectName,
      });
    }
  }

  return endpoints.map((endpoint) => {
    const varName = endpoint.objectName;

    // Walk up the mount graph from this var to accumulate prefixes
    const prefixes = [];
    const visited = new Set();
    let current = varName;
    let depth = 0;
    const MAX_DEPTH = 10;

    while (current && mountGraph.has(current)) {
      if (visited.has(current) || depth >= MAX_DEPTH) {
        // Cycle or depth exceeded — abandon resolution, return as-is
        prefixes.length = 0;
        break;
      }
      visited.add(current);
      const node = mountGraph.get(current);
      prefixes.unshift(node.prefix); // prepend: root prefixes come first
      current = node.parentVar;
      depth++;
    }

    if (prefixes.length === 0) {
      // No resolution possible or cycle detected — return unchanged
      return endpoint;
    }

    // Concatenate all prefixes with the endpoint path
    const combined = prefixes.join('') + endpoint.path;
    return {
      ...endpoint,
      path: normalizePath(combined),
      prefixResolved: true,
      prefixDepth: prefixes.length,
    };
  });
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

/**
 * Returns true if the path is a blanket wildcard (infrastructure-only pattern).
 * Used to detect CORS preflight catch-alls like app.options('*', cors()).
 *
 * Does NOT match explicit application paths such as /api/upload.
 *
 * @param {string} path - Normalised path string.
 * @returns {boolean}
 */
function isWildcardPath(path) {
  return path === '/*' || path === '*' || path === '/**' || path === '/.*';
}

module.exports = {
  extractApiEndpoints,
  resolvePrefixes,
};
