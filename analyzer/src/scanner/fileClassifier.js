/**
 * File Classifier
 * Categorizes repository files into standard semantic groups:
 * SOURCE, DOCUMENTATION, CONFIGURATION, INFRASTRUCTURE, BUILD, UNKNOWN
 */

const path = require('path');

const CATEGORIES = {
  SOURCE: 'SOURCE',
  DOCUMENTATION: 'DOCUMENTATION',
  CONFIGURATION: 'CONFIGURATION',
  INFRASTRUCTURE: 'INFRASTRUCTURE',
  BUILD: 'BUILD',
  UNKNOWN: 'UNKNOWN',
};

// Known source code extensions
const SOURCE_EXTENSIONS = new Set([
  // JavaScript & TypeScript
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts',
  // Python
  '.py', '.pyw',
  // Java, Kotlin, Scala, Groovy
  '.java', '.kt', '.kts', '.scala', '.groovy',
  // Go & Rust
  '.go', '.rs',
  // C, C++, C#
  '.c', '.h', '.cpp', '.hpp', '.cc', '.cxx', '.cs',
  // Web & Styles
  '.html', '.htm', '.css', '.scss', '.sass', '.less', '.vue', '.svelte',
  // Other major languages
  '.php', '.rb', '.swift', '.r', '.dart', '.lua', '.pl', '.pm',
  // Query & Schema
  '.sql', '.graphql', '.gql', '.proto',
  // Shell scripts
  '.sh', '.bash', '.zsh', '.ps1',
]);

// Documentation extensions & filenames
const DOC_EXTENSIONS = new Set([
  '.md', '.mdx', '.markdown', '.rst', '.adoc', '.asciidoc', '.tex',
]);

const DOC_FILENAMES = new Set([
  'readme', 'readme.txt', 'license', 'license.txt', 'changelog', 'changelog.txt',
  'contributing', 'contributing.txt', 'code_of_conduct', 'architecture', 'security',
]);

// Build tool filenames
const BUILD_FILENAMES = new Set([
  'makefile', 'gnumakefile', 'cmakelists.txt', 'build.xml', 'rakefile',
  'gruntfile.js', 'gulpfile.js',
]);

/**
 * Classifies a repository file into one of the standard categories.
 *
 * @param {string} filePath - Repository-relative file path.
 * @returns {string} One of CATEGORIES (SOURCE, DOCUMENTATION, CONFIGURATION, INFRASTRUCTURE, BUILD, UNKNOWN).
 */
const classifyFile = (filePath) => {
  if (!filePath || typeof filePath !== 'string') return CATEGORIES.UNKNOWN;

  const normalizedPath = filePath.replace(/\\/g, '/');
  const fileName = path.basename(normalizedPath).toLowerCase();
  const ext = path.extname(normalizedPath).toLowerCase();

  // 1. Check Infrastructure
  if (
    fileName === 'dockerfile' ||
    fileName.startsWith('dockerfile.') ||
    fileName === 'containerfile' ||
    fileName.startsWith('docker-compose') ||
    normalizedPath.startsWith('.github/workflows/') ||
    normalizedPath.startsWith('k8s/') ||
    normalizedPath.startsWith('kubernetes/') ||
    normalizedPath.startsWith('helm/') ||
    normalizedPath.startsWith('terraform/') ||
    ext === '.tf' ||
    ext === '.tfvars' ||
    ext === '.hcl' ||
    fileName === 'vagrantfile' ||
    fileName === 'procfile'
  ) {
    return CATEGORIES.INFRASTRUCTURE;
  }

  // 2. Check Build Files
  if (
    BUILD_FILENAMES.has(fileName) ||
    ext === '.cmake' ||
    fileName.endsWith('.gradle') ||
    fileName.endsWith('.gradle.kts')
  ) {
    return CATEGORIES.BUILD;
  }

  // 3. Check Documentation Extensions & Exact Filenames
  if (
    DOC_EXTENSIONS.has(ext) ||
    DOC_FILENAMES.has(fileName) ||
    DOC_FILENAMES.has(path.parse(fileName).name)
  ) {
    return CATEGORIES.DOCUMENTATION;
  }

  // 4. Check Configuration
  if (
    fileName === 'package.json' ||
    fileName === 'package-lock.json' ||
    fileName === 'pnpm-lock.yaml' ||
    fileName === 'yarn.lock' ||
    fileName.startsWith('tsconfig') ||
    fileName.startsWith('jsconfig') ||
    fileName === '.env.example' ||
    fileName === '.env.sample' ||
    fileName === '.env.template' ||
    fileName === '.env.dist' ||
    fileName === '.env.defaults' ||
    fileName === 'pom.xml' ||
    fileName.startsWith('requirements') ||
    fileName.startsWith('pipfile') ||
    fileName === 'cargo.toml' ||
    fileName === 'cargo.lock' ||
    fileName === 'go.mod' ||
    fileName === 'go.sum' ||
    fileName === 'composer.json' ||
    fileName.startsWith('gemfile') ||
    fileName.startsWith('webpack.config.') ||
    fileName.startsWith('vite.config.') ||
    fileName.startsWith('next.config.') ||
    fileName.startsWith('babel.config.') ||
    fileName.startsWith('.eslintrc') ||
    fileName.startsWith('.prettierrc') ||
    fileName.startsWith('jest.config.') ||
    fileName.startsWith('rollup.config.') ||
    ext === '.yaml' ||
    ext === '.yml' ||
    ext === '.toml' ||
    ext === '.ini' ||
    ext === '.cfg' ||
    ext === '.conf' ||
    ext === '.json'
  ) {
    return CATEGORIES.CONFIGURATION;
  }

  // 5. Check Documentation Folder (fallback for files in docs/ without specific config/source extensions)
  if (
    normalizedPath.startsWith('docs/') ||
    normalizedPath.startsWith('doc/') ||
    normalizedPath.startsWith('documentation/')
  ) {
    return CATEGORIES.DOCUMENTATION;
  }

  // 5. Check Source Code
  if (SOURCE_EXTENSIONS.has(ext)) {
    return CATEGORIES.SOURCE;
  }

  return CATEGORIES.UNKNOWN;
};

module.exports = {
  classifyFile,
  CATEGORIES,
  SOURCE_EXTENSIONS,
  DOC_EXTENSIONS,
};
