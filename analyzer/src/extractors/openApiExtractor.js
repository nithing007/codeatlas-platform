/**
 * OpenAPI / Swagger Extractor
 *
 * Extracts API endpoint facts from OpenAPI 3.x and Swagger 2.0 specification files.
 * Supports YAML and JSON formats.
 *
 * Extracts:
 *   - paths and HTTP methods
 *   - operationId where available
 *   - summary where available
 *
 * Handles malformed specifications gracefully — never throws on bad input.
 * Never executes specification content.
 */

const { normalizeMethod, normalizePath } = require('../utils/factNormalizer');

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace']);

/**
 * Minimal YAML parser for simple OpenAPI files.
 * Only handles the patterns needed for path/method extraction.
 * Falls back to the more robust regex approach if structure is unexpected.
 */

/**
 * Parses an OpenAPI/Swagger spec (JSON or YAML) and extracts endpoint facts.
 *
 * @param {string} content - File content (JSON or YAML string).
 * @param {string} filePath - Repository-relative path.
 * @returns {{ apiEndpoints: Array<Object>, warnings: Array<string> }}
 */
const extractFromOpenApi = (content, filePath) => {
  const apiEndpoints = [];
  const warnings = [];

  if (!content || typeof content !== 'string') {
    return { apiEndpoints, warnings };
  }

  const isJson = filePath.toLowerCase().endsWith('.json');

  if (isJson) {
    return extractFromOpenApiJson(content, filePath, warnings);
  } else {
    // YAML: try JSON first (some .yaml files are actually JSON), then YAML parsing
    try {
      JSON.parse(content);
      return extractFromOpenApiJson(content, filePath, warnings);
    } catch {
      return extractFromOpenApiYaml(content, filePath, warnings);
    }
  }
};

/**
 * Extracts from JSON-format OpenAPI spec.
 */
const extractFromOpenApiJson = (content, filePath, warnings) => {
  const apiEndpoints = [];

  let spec;
  try {
    spec = JSON.parse(content);
  } catch (err) {
    warnings.push(`[openApiExtractor] Failed to parse JSON spec ${filePath}: ${err.message}`);
    return { apiEndpoints, warnings };
  }

  if (!spec || typeof spec !== 'object') {
    warnings.push(`[openApiExtractor] ${filePath} is not a valid JSON object.`);
    return { apiEndpoints, warnings };
  }

  const paths = spec.paths || {};
  for (const [apiPath, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;

    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;
      if (!operation || typeof operation !== 'object') continue;

      apiEndpoints.push({
        type: 'API_ENDPOINT',
        source: filePath,
        path: normalizePath(apiPath),
        method: normalizeMethod(method),
        operationId: operation.operationId || null,
        summary: operation.summary || null,
        fromOpenApi: true,
      });
    }
  }

  return { apiEndpoints, warnings };
};

/**
 * Extracts from YAML-format OpenAPI spec using line-by-line pattern matching.
 * Avoids requiring a YAML parser dependency.
 */
const extractFromOpenApiYaml = (content, filePath, warnings) => {
  const apiEndpoints = [];

  try {
    const lines = content.split('\n');

    // State machine to track current path and extract methods/operationIds
    let currentPath = null;
    let insidePaths = false;
    let currentMethod = null;

    // Detect where 'paths:' section begins
    // Format:
    //   paths:
    //     /api/users:
    //       get:
    //         operationId: getUsers

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const line = raw.trimEnd();
      const indentation = raw.length - raw.trimStart().length;
      const trimmed = line.trim();

      if (trimmed === 'paths:') {
        insidePaths = true;
        currentPath = null;
        currentMethod = null;
        continue;
      }

      if (!insidePaths) continue;

      // Leaving paths section if we encounter a top-level key (indentation 0) that isn't 'paths:'
      if (indentation === 0 && trimmed !== '' && !trimmed.startsWith('#') && trimmed !== 'paths:') {
        insidePaths = false;
        currentPath = null;
        currentMethod = null;
        continue;
      }

      // Detect path key: 2-space indented lines starting with / and ending with :
      if (indentation === 2 && trimmed.startsWith('/') && trimmed.endsWith(':')) {
        currentPath = normalizePath(trimmed.slice(0, -1));
        currentMethod = null;
        continue;
      }

      // Detect HTTP method: 4-space indented known method ending with :
      if (indentation === 4 && currentPath !== null) {
        const methodKey = trimmed.endsWith(':') ? trimmed.slice(0, -1).toLowerCase() : null;
        if (methodKey && HTTP_METHODS.has(methodKey)) {
          currentMethod = normalizeMethod(methodKey);
          apiEndpoints.push({
            type: 'API_ENDPOINT',
            source: filePath,
            path: currentPath,
            method: currentMethod,
            operationId: null,
            summary: null,
            fromOpenApi: true,
            line: i + 1,
          });
          continue;
        }
      }

      // Detect operationId within current method block (indentation >= 6)
      if (indentation >= 6 && currentMethod !== null && trimmed.startsWith('operationId:')) {
        const opId = trimmed.replace(/^operationId:\s*/, '').trim();
        // Update the last endpoint with operationId
        const last = apiEndpoints[apiEndpoints.length - 1];
        if (last && last.path === currentPath && last.method === currentMethod) {
          last.operationId = opId || null;
        }
        continue;
      }

      // Detect summary within current method block
      if (indentation >= 6 && currentMethod !== null && trimmed.startsWith('summary:')) {
        const summary = trimmed.replace(/^summary:\s*/, '').replace(/^['"]|['"]$/g, '').trim();
        const last = apiEndpoints[apiEndpoints.length - 1];
        if (last && last.path === currentPath && last.method === currentMethod) {
          last.summary = summary || null;
        }
      }
    }
  } catch (err) {
    warnings.push(`[openApiExtractor] Error parsing YAML spec ${filePath}: ${err.message}`);
  }

  return { apiEndpoints, warnings };
};

module.exports = {
  extractFromOpenApi,
};
