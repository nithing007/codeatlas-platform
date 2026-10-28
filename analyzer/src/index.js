/**
 * CodeAtlas Analyzer Engine — Entrypoint
 * Standalone static repository analysis service.
 */

const RepositoryScanner = require('./scanner/repositoryScanner');
const GitHubRepositoryProvider = require('./providers/githubRepositoryProvider');
const MockRepositoryProvider = require('./providers/mockRepositoryProvider');
const { classifyFile, CATEGORIES } = require('./scanner/fileClassifier');
const { detectImportantFiles } = require('./scanner/importantFileDetector');
const { sanitizePath, isExcludedSecretFile } = require('./utils/pathSecurity');
const { isBinaryExtension, isBinaryContent } = require('./utils/binaryDetector');
const { normalizeMethod, normalizePath, normalizeEnvVarName } = require('./utils/factNormalizer');
const { extractApiEndpoints, resolvePrefixes } = require('./extractors/apiExtractor');
const { extractEnvVarsFromSource, extractEnvVarsFromTemplate } = require('./extractors/envExtractor');
const { extractFromPackageJson } = require('./extractors/dependencyExtractor');
const { extractFromDocumentation } = require('./extractors/documentationExtractor');
const { extractFromOpenApi } = require('./extractors/openApiExtractor');
const { detectDrift } = require('./drift/driftDetector');
const { detectApiDrift } = require('./drift/apiDriftDetector');
const { detectEnvDrift } = require('./drift/envDriftDetector');
const { createFinding, buildDriftResult } = require('./drift/findingFactory');
const { extractModuleGraph } = require('./extractors/moduleGraphExtractor');
const { resolveWithModuleGraph, resolveModulePath } = require('./extractors/crossFileResolver');
const config = require('./config');

/**
 * Convenience helper to scan a public GitHub repository.
 *
 * @param {string} owner - Repository owner.
 * @param {string} repo - Repository name.
 * @param {string} [branch='main'] - Branch to scan.
 * @param {Object} [options={}] - Custom scanner options.
 * @returns {Promise<Object>} Structured analysis result including facts.
 */
const analyzePublicRepository = async (owner, repo, branch = 'main', options = {}) => {
  const provider = new GitHubRepositoryProvider(options);
  const scanner = new RepositoryScanner(provider, options);
  return scanner.scan(owner, repo, branch);
};

module.exports = {
  RepositoryScanner,
  GitHubRepositoryProvider,
  MockRepositoryProvider,
  analyzePublicRepository,
  classifyFile,
  CATEGORIES,
  detectImportantFiles,
  sanitizePath,
  isExcludedSecretFile,
  isBinaryExtension,
  isBinaryContent,
  normalizeMethod,
  normalizePath,
  normalizeEnvVarName,
  extractApiEndpoints,
  resolvePrefixes,
  extractEnvVarsFromSource,
  extractEnvVarsFromTemplate,
  extractFromPackageJson,
  extractFromDocumentation,
  extractFromOpenApi,
  detectDrift,
  detectApiDrift,
  detectEnvDrift,
  createFinding,
  buildDriftResult,
  extractModuleGraph,
  resolveWithModuleGraph,
  resolveModulePath,
  config,
};
