/**
 * Repository Service
 * Handles business logic for repository preview, import, retrieval, and deletion.
 */

const mongoose = require('mongoose');
const Repository = require('../models/Repository');
const { parseGitHubRepoUrl } = require('../utils/githubUrlHelper');
const { fetchPublicRepositoryMetadata } = require('./githubService');

/**
 * Preview a public GitHub repository without importing or saving it to the database.
 *
 * @param {string} repositoryUrl - Raw repository URL string.
 * @returns {Promise<Object>} Normalized repository metadata.
 */
const previewRepository = async (repositoryUrl) => {
  const { owner, repo } = parseGitHubRepoUrl(repositoryUrl);
  const metadata = await fetchPublicRepositoryMetadata(owner, repo);
  return metadata;
};

/**
 * Imports a public GitHub repository into the authenticated user's CodeAtlas account.
 *
 * @param {string|mongoose.Types.ObjectId} userId - Authenticated user ID.
 * @param {string} repositoryUrl - Raw repository URL string.
 * @returns {Promise<Object>} The newly created Repository document.
 * @throws {Error} 409 Conflict if already imported, 400 if invalid/private.
 */
const importRepository = async (userId, repositoryUrl) => {
  const { owner, repo } = parseGitHubRepoUrl(repositoryUrl);
  const metadata = await fetchPublicRepositoryMetadata(owner, repo);

  if (metadata.private) {
    const error = new Error('Private repositories are not supported in public repository intake mode.');
    error.statusCode = 400;
    throw error;
  }

  // Check whether the user has already imported this repository
  const existingRepo = await Repository.findOne({
    userId,
    fullName: metadata.fullName,
  });

  if (existingRepo) {
    const error = new Error(`Repository "${metadata.fullName}" has already been imported into your account.`);
    error.statusCode = 409;
    throw error;
  }

  const newRepo = await Repository.create({
    userId,
    githubRepositoryId: metadata.githubRepositoryId,
    name: metadata.name,
    fullName: metadata.fullName,
    owner: metadata.owner,
    description: metadata.description,
    url: metadata.url,
    htmlUrl: metadata.htmlUrl,
    defaultBranch: metadata.defaultBranch,
    private: metadata.private,
    visibility: metadata.visibility,
    language: metadata.language,
    stars: metadata.stars,
    forks: metadata.forks,
    openIssues: metadata.openIssues,
    size: metadata.size,
  });

  return newRepo;
};

/**
 * Retrieves all repositories belonging to the authenticated user.
 *
 * @param {string|mongoose.Types.ObjectId} userId - Authenticated user ID.
 * @returns {Promise<Array<Object>>} List of user's repositories.
 */
const getUserRepositories = async (userId) => {
  return Repository.find({ userId }).sort({ createdAt: -1 });
};

/**
 * Retrieves a single repository by ID belonging strictly to the authenticated user.
 *
 * @param {string|mongoose.Types.ObjectId} userId - Authenticated user ID.
 * @param {string} repositoryId - MongoDB ObjectId of the repository.
 * @returns {Promise<Object>} The repository document.
 * @throws {Error} 404 Not Found if the repository does not exist or belongs to another user.
 */
const getRepositoryById = async (userId, repositoryId) => {
  if (!mongoose.Types.ObjectId.isValid(repositoryId)) {
    const error = new Error('Repository not found.');
    error.statusCode = 404;
    throw error;
  }

  const repo = await Repository.findOne({
    _id: repositoryId,
    userId,
  });

  if (!repo) {
    const error = new Error('Repository not found.');
    error.statusCode = 404;
    throw error;
  }

  return repo;
};

/**
 * Deletes a repository association from CodeAtlas.
 * Does not delete the actual repository on GitHub.
 *
 * @param {string|mongoose.Types.ObjectId} userId - Authenticated user ID.
 * @param {string} repositoryId - MongoDB ObjectId of the repository.
 * @returns {Promise<Object>} Confirmation message and repository ID.
 * @throws {Error} 404 Not Found if the repository does not exist or belongs to another user.
 */
const deleteRepository = async (userId, repositoryId) => {
  if (!mongoose.Types.ObjectId.isValid(repositoryId)) {
    const error = new Error('Repository not found.');
    error.statusCode = 404;
    throw error;
  }

  const repo = await Repository.findOneAndDelete({
    _id: repositoryId,
    userId,
  });

  if (!repo) {
    const error = new Error('Repository not found.');
    error.statusCode = 404;
    throw error;
  }

  return {
    message: 'Repository removed from CodeAtlas successfully.',
    repositoryId: repo._id,
  };
};

module.exports = {
  previewRepository,
  importRepository,
  getUserRepositories,
  getRepositoryById,
  deleteRepository,
};
