/**
 * Repository Controller
 * Thin request/response handlers for repository preview, import, listing, get, and delete.
 */

const repositoryService = require('../services/repositoryService');

/**
 * POST /api/repositories/preview
 * Validate GitHub URL and preview public repository metadata without saving.
 */
const previewRepository = async (req, res, next) => {
  try {
    const { repositoryUrl } = req.body;
    const repository = await repositoryService.previewRepository(repositoryUrl);
    res.status(200).json({
      success: true,
      repository,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/repositories
 * Import a public GitHub repository into the authenticated user's account.
 */
const importRepository = async (req, res, next) => {
  try {
    const { repositoryUrl } = req.body;
    const repository = await repositoryService.importRepository(req.user._id, repositoryUrl);
    res.status(201).json({
      success: true,
      message: 'Repository imported successfully.',
      repository,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/repositories
 * List all repositories belonging exclusively to the authenticated user.
 */
const listRepositories = async (req, res, next) => {
  try {
    const repositories = await repositoryService.getUserRepositories(req.user._id);
    res.status(200).json({
      success: true,
      count: repositories.length,
      repositories,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/repositories/:id
 * Retrieve single repository details belonging to the authenticated user.
 */
const getRepository = async (req, res, next) => {
  try {
    const repository = await repositoryService.getRepositoryById(req.user._id, req.params.id);
    res.status(200).json({
      success: true,
      repository,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/repositories/:id
 * Remove a repository association from CodeAtlas (does not delete GitHub repo).
 */
const deleteRepository = async (req, res, next) => {
  try {
    const result = await repositoryService.deleteRepository(req.user._id, req.params.id);
    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  previewRepository,
  importRepository,
  listRepositories,
  getRepository,
  deleteRepository,
};
