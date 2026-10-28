/**
 * Cross-File Router Prefix Resolver
 *
 * Resolves Express router prefix chains that span multiple source files by
 * tracing require()/import → module.exports/export-default relationships.
 *
 * Algorithm overview:
 *   1. Resolve every require()/import path to an actual file path using the
 *      known repository file tree (no guessing, no code execution).
 *   2. Build an "importedBy" graph:
 *        targetFilePath → Array<{ fromFilePath, prefix, objectName }>
 *      Each entry means: "fromFilePath mounts targetFilePath with `prefix`
 *      using the variable `objectName`."
 *   3. For each unresolved endpoint whose objectName matches the file's
 *      exported variable, walk the importedBy graph upward to accumulate
 *      ancestor prefixes (root → leaf order).
 *   4. Cycle detection prevents infinite recursion.
 *   5. Ambiguous cases (multiple mounts of the same file) use the first
 *      mount only (conservative).
 *   6. Original evidence (source file + line number) is always preserved.
 *   7. Produces no duplicate facts after resolution.
 *
 * Safety guarantees:
 *   - No code execution, no eval, no require().
 *   - Unresolvable relationships are kept as-is (conservative fallback).
 *   - Works with CommonJS and ES module patterns.
 */

'use strict';

const { normalizePath } = require('../utils/factNormalizer');

// Candidate file extensions to try when resolving a bare module path
const RESOLVE_EXTENSIONS = [
  '',           // exact (already has extension)
  '.js',
  '.ts',
  '.mjs',
  '.cjs',
  '.jsx',
  '.tsx',
  '/index.js',
  '/index.ts',
  '/index.mjs',
];

// ── Path resolution ─────────────────────────────────────────────────────────

/**
 * Normalises a POSIX path by collapsing . and .. segments.
 * Input and output use forward slashes.
 *
 * @param {string} p
 * @returns {string}
 */
function normalizePosixPath(p) {
  const parts = p.split('/');
  const stack = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') { if (stack.length > 0) stack.pop(); }
    else stack.push(part);
  }
  return stack.join('/');
}

/**
 * Resolves a relative require/import path to an actual repository file path.
 *
 * Tries common file extensions and index.js patterns.
 * Returns null if no matching file exists in the repository file set.
 *
 * @param {string}      currentFilePath - POSIX path of the importing file.
 * @param {string}      relativePath    - The raw import path (e.g. './auth.route').
 * @param {Set<string>} filePathSet     - All known file paths in the repository.
 * @returns {string|null}
 */
function resolveModulePath(currentFilePath, relativePath, filePathSet) {
  if (!relativePath || !relativePath.startsWith('.')) return null;

  // Directory of the importing file
  const dir = currentFilePath.includes('/')
    ? currentFilePath.substring(0, currentFilePath.lastIndexOf('/'))
    : '';

  const base = dir ? `${dir}/${relativePath}` : relativePath;
  const normalized = normalizePosixPath(base);

  for (const ext of RESOLVE_EXTENSIONS) {
    const candidate = normalized + ext;
    if (filePathSet.has(candidate)) return candidate;
  }

  return null;
}

// ── Graph walk ───────────────────────────────────────────────────────────────

/**
 * Recursively walks the importedBy graph upward from `filePath`, collecting
 * ancestor prefixes in root-first order into the `prefixes` array.
 *
 * @param {string}              filePath
 * @param {Array<string>}       prefixes    - Accumulator (mutated).
 * @param {Map}                 importedBy  - targetFile → Array<{fromFilePath,prefix,objectName}>
 * @param {Map<string,string>}  fileExportsMap - filePath → exported variable name
 * @param {Set<string>}         visited     - Cycle guard.
 * @returns {boolean} false if a cycle was detected, true otherwise.
 */
function walkChain(filePath, prefixes, importedBy, fileExportsMap, visited) {
  if (visited.has(filePath)) return false; // cycle
  visited.add(filePath);

  const mounts = importedBy.get(filePath);
  if (!mounts || mounts.length === 0) return true; // root reached — no more parents

  // Take the first mount only (conservative: multiple mounts = ambiguous)
  const { fromFilePath, prefix, objectName } = mounts[0];

  // Only chain further if the mounting object is itself the exported router of
  // fromFilePath — otherwise we've reached a root-level object (e.g. `app`).
  const parentExportedVar = fileExportsMap.get(fromFilePath);
  if (parentExportedVar && objectName === parentExportedVar) {
    if (!walkChain(fromFilePath, prefixes, importedBy, fileExportsMap, visited)) {
      return false; // cycle in parent chain
    }
  }

  // Prepend this level's prefix (push after recursive call → root-first order)
  prefixes.push(prefix);
  return true;
}

// ── Main resolution entry point ──────────────────────────────────────────────

/**
 * Applies cross-file mount prefix chains to unresolved endpoints.
 *
 * Only endpoints that:
 *   - Have `prefixResolved === false`
 *   - Have an objectName that matches the exporting variable of their source file
 * are candidates for cross-file resolution.
 *
 * All other endpoints are passed through unchanged.
 *
 * @param {Array<Object>} endpoints        - All endpoints (may be partially resolved).
 * @param {Array<Object>} allMounts        - All .use() mount records from all files.
 * @param {Map}           fileRequiresMap  - filePath → Map<varName, relativePath>
 * @param {Map}           fileExportsMap   - filePath → exportedVarName
 * @param {Set<string>}   filePathSet      - All repository file paths.
 * @returns {Array<Object>} Endpoints with cross-file prefixes applied where possible.
 */
const resolveWithModuleGraph = (
  endpoints,
  allMounts,
  fileRequiresMap,
  fileExportsMap,
  filePathSet
) => {
  if (!fileRequiresMap || fileRequiresMap.size === 0) return endpoints;
  if (!allMounts || allMounts.length === 0) return endpoints;

  // ── Step 1: Resolve all relative require paths to actual file paths ──────
  // resolvedRequiresMap: filePath → Map<varName, resolvedFilePath>
  const resolvedRequiresMap = new Map();
  for (const [filePath, requiresMap] of fileRequiresMap) {
    const resolved = new Map();
    for (const [varName, relativePath] of requiresMap) {
      const resolvedPath = resolveModulePath(filePath, relativePath, filePathSet);
      if (resolvedPath) resolved.set(varName, resolvedPath);
    }
    resolvedRequiresMap.set(filePath, resolved);
  }

  // ── Step 2: Build importedBy graph ──────────────────────────────────────
  // importedBy: targetFilePath → Array<{ fromFilePath, prefix, objectName }>
  const importedBy = new Map();
  for (const mount of allMounts) {
    const { objectName, prefix, routerVar, source: fromFilePath } = mount;
    const fromResolved = resolvedRequiresMap.get(fromFilePath);
    if (!fromResolved) continue;
    const targetFilePath = fromResolved.get(routerVar);
    if (!targetFilePath) continue;

    if (!importedBy.has(targetFilePath)) importedBy.set(targetFilePath, []);
    importedBy.get(targetFilePath).push({ fromFilePath, prefix, objectName });
  }

  if (importedBy.size === 0) return endpoints;

  // ── Step 3: Resolve each eligible unresolved endpoint ──────────────────
  const seen = new Set(); // deduplication key: method:path:source:line
  const result = [];

  for (const endpoint of endpoints) {
    // Pass-through already-resolved endpoints (single-file resolver handled them)
    if (endpoint.prefixResolved) {
      const key = `${endpoint.method}:${endpoint.path}:${endpoint.source}:${endpoint.line}`;
      if (!seen.has(key)) { seen.add(key); result.push(endpoint); }
      continue;
    }

    const { objectName, source: filePath } = endpoint;
    const exportedVar = fileExportsMap.get(filePath);

    // Only attempt resolution if the endpoint's object is the file's exported router
    if (!exportedVar || objectName !== exportedVar) {
      const key = `${endpoint.method}:${endpoint.path}:${endpoint.source}:${endpoint.line}`;
      if (!seen.has(key)) { seen.add(key); result.push(endpoint); }
      continue;
    }

    // Walk the importedBy chain
    const prefixes = [];
    const visited = new Set();
    const ok = walkChain(filePath, prefixes, importedBy, fileExportsMap, visited);

    if (ok && prefixes.length > 0) {
      const combined = normalizePath(prefixes.join('') + endpoint.path);
      const key = `${endpoint.method}:${combined}:${endpoint.source}:${endpoint.line}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push({
          ...endpoint,
          path: combined,
          prefixResolved: true,
          prefixDepth: prefixes.length,
        });
      }
    } else {
      // Could not resolve — keep conservative unresolved path
      const key = `${endpoint.method}:${endpoint.path}:${endpoint.source}:${endpoint.line}`;
      if (!seen.has(key)) { seen.add(key); result.push(endpoint); }
    }
  }

  return result;
};

module.exports = { resolveWithModuleGraph, resolveModulePath };
