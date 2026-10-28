/**
 * Repository Provider Interface
 * Abstract base class for fetching repository tree, file metadata, and content.
 */

class RepositoryProvider {
  /**
   * Fetches the complete file tree of a repository.
   *
   * @param {string} owner - Repository owner.
   * @param {string} repo - Repository name.
   * @param {string} [branch='main'] - Target branch or ref.
   * @returns {Promise<{ commitSha: string, tree: Array<{ path: string, size?: number, type: 'blob'|'tree', sha?: string }> }>}
   */
  async getTree(owner, repo, branch = 'main') {
    throw new Error('getTree() must be implemented by concrete repository provider.');
  }

  /**
   * Fetches raw content of a specific file.
   *
   * @param {string} owner - Repository owner.
   * @param {string} repo - Repository name.
   * @param {string} filePath - Repository-relative file path.
   * @param {string} [branch='main'] - Target branch or ref.
   * @returns {Promise<{ content: string, size: number, encoding: string }>}
   */
  async getFileContent(owner, repo, filePath, branch = 'main') {
    throw new Error('getFileContent() must be implemented by concrete repository provider.');
  }
}

module.exports = RepositoryProvider;
