/**
 * Module Graph Extractor
 *
 * Extracts CommonJS require() and ES module import/export statements from
 * JS/TS source files for use in cross-file router prefix resolution.
 *
 * Detects:
 *   - CommonJS:   const foo = require('./path')
 *   - ES modules: import foo from './path'
 *   - CommonJS:   module.exports = varName
 *   - ES modules: export default varName
 *
 * Only tracks relative imports (starting with ./ or ../).
 * Absolute/node_modules imports are ignored — they cannot be resolved
 * against the repository file tree without executing code.
 *
 * Never executes code. Pure regex-based static analysis.
 */

'use strict';

// CommonJS: const foo = require('./path')
// Also matches: let/var declarations
// Does NOT match destructured: const { foo } = require('./path')
// (destructured imports use the original module's export names, not local var names)
const REQUIRE_ASSIGN_PATTERN =
  /(?:const|let|var)\s+(\w+)\s*=\s*require\s*\(\s*(['"`])([^'"`]+)\2\s*\)/g;

// ES module default import: import foo from './path'
// Does NOT match named imports: import { foo } from './path'
const IMPORT_DEFAULT_PATTERN =
  /import\s+(\w+)\s+from\s+(['"`])([^'"`]+)\2/g;

// CommonJS: module.exports = someVar
// Also: exports.default = someVar (less common but valid)
const MODULE_EXPORTS_PATTERN =
  /module\.exports\s*=\s*(\w+)\b/;

// ES module: export default someVar
const EXPORT_DEFAULT_PATTERN =
  /export\s+default\s+(\w+)\b/;

/**
 * Extracts require/import variable assignments and the file's default export
 * variable name.
 *
 * @param {string} content  - File content to analyze.
 * @param {string} filePath - Repository-relative file path (unused here but
 *                            passed for symmetry with other extractors).
 * @returns {{
 *   requires: Map<string, string>,  // varName → relative import path
 *   exportedVar: string|null,       // variable name passed to module.exports/export default
 * }}
 */
const extractModuleGraph = (content, filePath) => {
  const requires = new Map(); // varName -> relativePath
  let exportedVar = null;

  if (!content || typeof content !== 'string') {
    return { requires, exportedVar };
  }

  // CommonJS require() assignments
  REQUIRE_ASSIGN_PATTERN.lastIndex = 0;
  let m;
  while ((m = REQUIRE_ASSIGN_PATTERN.exec(content)) !== null) {
    const varName = m[1];
    const requirePath = m[3];
    // Only track relative imports
    if (requirePath.startsWith('.') && !requires.has(varName)) {
      requires.set(varName, requirePath);
    }
  }

  // ES module default imports
  IMPORT_DEFAULT_PATTERN.lastIndex = 0;
  while ((m = IMPORT_DEFAULT_PATTERN.exec(content)) !== null) {
    const varName = m[1];
    const importPath = m[3];
    if (importPath.startsWith('.') && !requires.has(varName)) {
      requires.set(varName, importPath);
    }
  }

  // CommonJS module.exports
  const exportsMatch = MODULE_EXPORTS_PATTERN.exec(content);
  if (exportsMatch) {
    exportedVar = exportsMatch[1];
  }

  // ES module export default (fallback if no CommonJS export found)
  if (!exportedVar) {
    const exportMatch = EXPORT_DEFAULT_PATTERN.exec(content);
    if (exportMatch) {
      exportedVar = exportMatch[1];
    }
  }

  return { requires, exportedVar };
};

module.exports = { extractModuleGraph };
