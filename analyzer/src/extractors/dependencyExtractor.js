/**
 * Dependency Extractor
 *
 * Extracts structured facts from package.json files:
 *   - Runtime dependencies (DEPENDENCY)
 *   - Dev dependencies (DEPENDENCY with section: 'devDependencies')
 *   - NPM scripts (SCRIPT)
 *
 * Never executes scripts or installs packages.
 * Handles malformed JSON gracefully.
 */

/**
 * Extracts dependency and script facts from a package.json file content.
 *
 * @param {string} content - Raw package.json file content (untrusted text).
 * @param {string} filePath - Repository-relative path for attribution.
 * @returns {{ dependencies: Array<Object>, scripts: Array<Object>, warnings: Array<string> }}
 */
const extractFromPackageJson = (content, filePath) => {
  const dependencies = [];
  const scripts = [];
  const warnings = [];

  if (!content || typeof content !== 'string') {
    return { dependencies, scripts, warnings };
  }

  let pkg;
  try {
    pkg = JSON.parse(content);
  } catch (err) {
    warnings.push(`[dependencyExtractor] Failed to parse ${filePath}: ${err.message}`);
    return { dependencies, scripts, warnings };
  }

  if (!pkg || typeof pkg !== 'object') {
    warnings.push(`[dependencyExtractor] ${filePath} is not a valid JSON object.`);
    return { dependencies, scripts, warnings };
  }

  // Extract runtime dependencies
  if (pkg.dependencies && typeof pkg.dependencies === 'object') {
    for (const [name, version] of Object.entries(pkg.dependencies)) {
      if (typeof name === 'string' && typeof version === 'string') {
        dependencies.push({
          type: 'DEPENDENCY',
          name,
          version,
          section: 'dependencies',
          source: filePath,
        });
      }
    }
  }

  // Extract dev dependencies
  if (pkg.devDependencies && typeof pkg.devDependencies === 'object') {
    for (const [name, version] of Object.entries(pkg.devDependencies)) {
      if (typeof name === 'string' && typeof version === 'string') {
        dependencies.push({
          type: 'DEPENDENCY',
          name,
          version,
          section: 'devDependencies',
          source: filePath,
        });
      }
    }
  }

  // Extract peer dependencies
  if (pkg.peerDependencies && typeof pkg.peerDependencies === 'object') {
    for (const [name, version] of Object.entries(pkg.peerDependencies)) {
      if (typeof name === 'string' && typeof version === 'string') {
        dependencies.push({
          type: 'DEPENDENCY',
          name,
          version,
          section: 'peerDependencies',
          source: filePath,
        });
      }
    }
  }

  // Extract scripts (never execute them)
  if (pkg.scripts && typeof pkg.scripts === 'object') {
    for (const [name, command] of Object.entries(pkg.scripts)) {
      if (typeof name === 'string' && typeof command === 'string') {
        scripts.push({
          type: 'SCRIPT',
          name,
          command,
          source: filePath,
        });
      }
    }
  }

  return { dependencies, scripts, warnings };
};

module.exports = {
  extractFromPackageJson,
};
