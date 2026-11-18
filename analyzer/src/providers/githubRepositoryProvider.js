/**
 * GitHub Repository Provider
 * Uses GitHub public REST APIs to fetch repository file trees and file contents.
 */

const RepositoryProvider = require('./repositoryProvider');
const config = require('../config');

const GITHUB_API_BASE_URL = 'https://api.github.com';
const GITHUB_RAW_BASE_URL = 'https://raw.githubusercontent.com';

class GitHubRepositoryProvider extends RepositoryProvider {
  constructor(options = {}) {
    super();
    this.timeoutMs = options.timeoutMs || config.githubApiTimeoutMs;
  }

  /**
   * Helper to perform fetch with timeout and standard GitHub headers.
   */
  async _fetch(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'CodeAtlas-Analyzer/1.0',
          ...(options.headers || {}),
        },
      });
      clearTimeout(timeout);
      return res;
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        const timeoutErr = new Error(`GitHub API request timed out after ${this.timeoutMs}ms.`);
        timeoutErr.statusCode = 504;
        throw timeoutErr;
      }
      const netErr = new Error(`GitHub network error: ${err.message}`);
      netErr.statusCode = 502;
      throw netErr;
    }
  }

  /**
   * Determines whether an HTTP response indicates GitHub rate limiting.
   * GitHub signals rate limiting either via HTTP 429 or HTTP 403 with x-ratelimit-remaining: '0'.
   * Other HTTP 403 responses represent authorization/permission failures (e.g. private repo or forbidden).
   *
   * @param {Response} res - Fetch Response object or mock response.
   * @returns {boolean}
   */
  _isRateLimited(res) {
    if (res.status === 429) {
      return true;
    }
    if (res.status === 403) {
      const remaining = res.headers && typeof res.headers.get === 'function'
        ? res.headers.get('x-ratelimit-remaining')
        : (res.headers && res.headers['x-ratelimit-remaining']);
      return remaining === '0';
    }
    return false;
  }

  /**
   * Fetches the complete file tree of a public GitHub repository.
   *
   * @param {string} owner - Repository owner.
   * @param {string} repo - Repository name.
   * @param {string} [branch='main'] - Target branch.
   * @param {string} [targetCommitSha=null] - Exact commit SHA to query directly (skips branch ref lookup).
   * @returns {Promise<{ commitSha: string, tree: Array<{ path: string, size?: number, type: string, sha: string }> }>}
   */
  async getTree(owner, repo, branch = 'main', targetCommitSha = null) {
    let commitSha = targetCommitSha;

    if (!commitSha) {
      // 1. Resolve branch to latest commit SHA if not explicitly supplied
      const commitUrl = `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(branch)}`;
      const commitRes = await this._fetch(commitUrl);

      if (commitRes.status === 404) {
        const error = new Error(`Repository or branch "${owner}/${repo}#${branch}" not found on GitHub.`);
        error.statusCode = 404;
        throw error;
      }

      if (this._isRateLimited(commitRes)) {
        const error = new Error('GitHub API rate limit exceeded during repository scan.');
        error.statusCode = 429;
        throw error;
      }

      if (commitRes.status === 403) {
        const error = new Error(`Access to repository "${owner}/${repo}#${branch}" was forbidden on GitHub.`);
        error.statusCode = 403;
        throw error;
      }

      if (!commitRes.ok) {
        const error = new Error(`GitHub API error: ${commitRes.status}`);
        error.statusCode = commitRes.status;
        throw error;
      }

      const commitData = await commitRes.json();
      commitSha = commitData.sha;
    }

    // 2. Fetch recursive git tree using commit SHA
    const treeUrl = `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${commitSha}?recursive=1`;
    const treeRes = await this._fetch(treeUrl);

    if (this._isRateLimited(treeRes)) {
      const error = new Error('GitHub API rate limit exceeded during repository tree scan.');
      error.statusCode = 429;
      throw error;
    }

    if (treeRes.status === 403) {
      const error = new Error(`Access to repository tree for "${owner}/${repo}" was forbidden on GitHub.`);
      error.statusCode = 403;
      throw error;
    }

    if (!treeRes.ok) {
      const error = new Error(`Failed to fetch repository tree: ${treeRes.status}`);
      error.statusCode = treeRes.status;
      throw error;
    }

    const treeData = await treeRes.json();

    // Filter only blobs (files) and sanitize paths
    const files = (treeData.tree || [])
      .filter((item) => item.type === 'blob')
      .map((item) => ({
        path: item.path,
        size: item.size || 0,
        type: 'blob',
        sha: item.sha,
      }));

    return {
      commitSha,
      tree: files,
      truncated: Boolean(treeData.truncated),
    };
  }

  /**
   * Fetches raw content of a specific file from GitHub.
   *
   * @param {string} owner - Repository owner.
   * @param {string} repo - Repository name.
   * @param {string} filePath - Path of the file.
   * @param {string} [branch='main'] - Branch or commit SHA.
   * @returns {Promise<{ content: string, size: number }>}
   */
  async getFileContent(owner, repo, filePath, branch = 'main') {
    const rawUrl = `${GITHUB_RAW_BASE_URL}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(branch)}/${filePath}`;
    const res = await this._fetch(rawUrl);

    if (this._isRateLimited(res)) {
      const error = new Error(`GitHub rate limit exceeded while retrieving "${filePath}".`);
      error.statusCode = 429;
      throw error;
    }

    if (res.status === 403) {
      const error = new Error(`Access to file "${filePath}" in repository "${owner}/${repo}" was forbidden.`);
      error.statusCode = 403;
      throw error;
    }

    if (res.status === 404) {
      const error = new Error(`File "${filePath}" not found in repository "${owner}/${repo}".`);
      error.statusCode = 404;
      throw error;
    }

    if (!res.ok) {
      const error = new Error(`Failed to retrieve file content: ${res.status}`);
      error.statusCode = res.status;
      throw error;
    }

    const text = await res.text();
    return {
      content: text,
      size: Buffer.byteLength(text, 'utf8'),
    };
  }
}

module.exports = GitHubRepositoryProvider;
