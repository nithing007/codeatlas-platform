/**
 * Important File Detector
 * Identifies key project files required for architectural analysis and documentation drift detection.
 */

const path = require('path');

/**
 * Categorizes important files across the repository.
 *
 * @param {Array<{path: string}>} fileList - List of file inventory objects.
 * @returns {Object} Grouped lists of important file paths.
 */
const detectImportantFiles = (fileList) => {
  const important = {
    readme: [],
    environment: [],
    packageManifests: [],
    apiSpecifications: [],
    docker: [],
    kubernetes: [],
  };

  if (!Array.isArray(fileList)) return important;

  for (const file of fileList) {
    const filePath = file.path;
    const normalized = filePath.replace(/\\/g, '/');
    const fileName = path.basename(normalized).toLowerCase();
    const parsed = path.parse(fileName);
    const baseNameWithoutExt = parsed.name.toLowerCase();

    // 1. README detection (root or docs README)
    if (baseNameWithoutExt === 'readme') {
      important.readme.push(filePath);
    }

    // 2. Environment example / template files
    if (
      fileName === '.env.example' ||
      fileName === '.env.sample' ||
      fileName === '.env.template' ||
      fileName === '.env.dist' ||
      fileName === '.env.defaults'
    ) {
      important.environment.push(filePath);
    }

    // 3. Package & Dependency manifests
    if (
      fileName === 'package.json' ||
      fileName === 'pom.xml' ||
      fileName === 'build.gradle' ||
      fileName === 'build.gradle.kts' ||
      fileName === 'requirements.txt' ||
      fileName === 'pipfile' ||
      fileName === 'cargo.toml' ||
      fileName === 'go.mod' ||
      fileName === 'composer.json' ||
      fileName === 'gemfile'
    ) {
      important.packageManifests.push(filePath);
    }

    // 4. API Specification files (OpenAPI / Swagger)
    if (
      fileName === 'openapi.json' ||
      fileName === 'openapi.yaml' ||
      fileName === 'openapi.yml' ||
      fileName === 'swagger.json' ||
      fileName === 'swagger.yaml' ||
      fileName === 'swagger.yml' ||
      fileName.includes('openapi') ||
      fileName.includes('swagger') ||
      fileName.includes('api-spec') ||
      fileName.includes('api_spec')
    ) {
      important.apiSpecifications.push(filePath);
    }

    // 5. Docker & Container configuration
    if (
      fileName === 'dockerfile' ||
      fileName.startsWith('dockerfile.') ||
      fileName === 'containerfile' ||
      fileName === 'docker-compose.yml' ||
      fileName === 'docker-compose.yaml' ||
      fileName.startsWith('docker-compose.')
    ) {
      important.docker.push(filePath);
    }

    // 6. Kubernetes manifests
    if (
      normalized.startsWith('k8s/') ||
      normalized.startsWith('kubernetes/') ||
      normalized.startsWith('helm/') ||
      fileName.includes('.k8s.') ||
      fileName.includes('.kube.')
    ) {
      if (fileName.endsWith('.yaml') || fileName.endsWith('.yml') || fileName.endsWith('.json')) {
        important.kubernetes.push(filePath);
      }
    }
  }

  return important;
};

module.exports = {
  detectImportantFiles,
};
