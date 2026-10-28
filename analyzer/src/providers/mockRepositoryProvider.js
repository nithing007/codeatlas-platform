/**
 * Mock Repository Provider
 * In-memory provider for fast, deterministic unit and integration tests.
 */

const RepositoryProvider = require('./repositoryProvider');

class MockRepositoryProvider extends RepositoryProvider {
  /**
   * @param {Object} [repositories={}] - Keyed by "owner/repo" -> { commitSha, files: { [path]: content | { content, size } } }
   */
  constructor(repositories = {}) {
    super();
    this.repositories = repositories;
  }

  /**
   * Register or update a mock repository fixture.
   */
  addRepository(owner, repo, { commitSha = 'mocksha1234567890', files = {} } = {}) {
    const key = `${owner}/${repo}`.toLowerCase();
    this.repositories[key] = {
      commitSha,
      files,
    };
  }

  async getTree(owner, repo, branch = 'main') {
    const key = `${owner}/${repo}`.toLowerCase();
    const repoData = this.repositories[key];

    if (!repoData) {
      const error = new Error(`Repository "${owner}/${repo}" not found.`);
      error.statusCode = 404;
      throw error;
    }

    const tree = Object.entries(repoData.files).map(([filePath, fileInfo]) => {
      let size = 0;
      if (typeof fileInfo === 'string') {
        size = Buffer.byteLength(fileInfo, 'utf8');
      } else if (fileInfo && typeof fileInfo.size === 'number') {
        size = fileInfo.size;
      }

      return {
        path: filePath,
        size,
        type: 'blob',
        sha: 'mockfilesha_' + filePath,
      };
    });

    return {
      commitSha: repoData.commitSha,
      tree,
      truncated: false,
    };
  }

  async getFileContent(owner, repo, filePath, branch = 'main') {
    const key = `${owner}/${repo}`.toLowerCase();
    const repoData = this.repositories[key];

    if (!repoData || !repoData.files || !(filePath in repoData.files)) {
      const error = new Error(`File "${filePath}" not found in mock repository.`);
      error.statusCode = 404;
      throw error;
    }

    const fileInfo = repoData.files[filePath];
    let content = '';
    let size = 0;

    if (typeof fileInfo === 'string') {
      content = fileInfo;
      size = Buffer.byteLength(content, 'utf8');
    } else if (fileInfo && typeof fileInfo.content === 'string') {
      content = fileInfo.content;
      size = fileInfo.size || Buffer.byteLength(content, 'utf8');
    }

    return {
      content,
      size,
    };
  }
}

module.exports = MockRepositoryProvider;
