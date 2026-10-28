/**
 * GitHub API Service
 * Handles communication with the public GitHub REST API.
 * Does not require OAuth for public repository metadata retrieval.
 */

const GITHUB_API_BASE_URL = 'https://api.github.com';

/**
 * Fetches public repository metadata from GitHub REST API.
 *
 * @param {string} owner - Repository owner username/organization.
 * @param {string} repo - Repository name.
 * @returns {Promise<Object>} Normalized GitHub repository metadata.
 * @throws {Error} Descriptive error on 404, rate limit (403/429), or network error.
 */
const fetchPublicRepositoryMetadata = async (owner, repo) => {
  const url = `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'CodeAtlas-Platform/1.0',
      },
    });
  } catch (networkError) {
    const error = new Error(`Failed to reach GitHub API: ${networkError.message}`);
    error.statusCode = 502;
    throw error;
  }

  // Handle GitHub Rate Limiting
  if (response.status === 403 || response.status === 429) {
    const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
    if (rateLimitRemaining === '0') {
      const resetTime = response.headers.get('x-ratelimit-reset');
      const resetDate = resetTime ? new Date(parseInt(resetTime, 10) * 1000).toLocaleTimeString() : 'shortly';
      const error = new Error(`GitHub API rate limit exceeded. Please try again after ${resetDate}.`);
      error.statusCode = 429;
      throw error;
    }

    const error = new Error('Access to GitHub repository was forbidden.');
    error.statusCode = 403;
    throw error;
  }

  // Handle Not Found or Private Repository
  if (response.status === 404) {
    const error = new Error(
      `Repository "${owner}/${repo}" was not found on GitHub or is private. Only public repositories can be imported without GitHub authorization.`
    );
    error.statusCode = 404;
    throw error;
  }

  if (!response.ok) {
    const error = new Error(`GitHub API returned unexpected status: ${response.status}`);
    error.statusCode = response.status >= 500 ? 502 : response.status;
    throw error;
  }

  const data = await response.json();

  return {
    githubRepositoryId: data.id ? data.id.toString() : null,
    name: data.name,
    fullName: data.full_name,
    owner: data.owner ? data.owner.login : owner,
    description: data.description || null,
    url: data.url,
    htmlUrl: data.html_url,
    defaultBranch: data.default_branch || 'main',
    private: Boolean(data.private),
    visibility: data.visibility || (data.private ? 'private' : 'public'),
    language: data.language || null,
    stars: data.stargazers_count || 0,
    forks: data.forks_count || 0,
    openIssues: data.open_issues_count || 0,
    size: data.size || 0,
    createdAt: data.created_at ? new Date(data.created_at) : null,
    updatedAt: data.updated_at ? new Date(data.updated_at) : null,
  };
};

/**
 * Resolves the current HEAD commit SHA for a given branch of a public repository.
 *
 * @param {string} owner  - Repository owner username/organization.
 * @param {string} repo   - Repository name.
 * @param {string} branch - Branch name (e.g. "main", "master").
 * @returns {Promise<string>} 40-character Git commit SHA.
 * @throws {Error} Descriptive error on 404, rate limit, or network failure.
 */
const resolveCommitSha = async (owner, repo, branch) => {
  const url = `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(branch)}`;

  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'CodeAtlas-Platform/1.0',
      },
    });
  } catch (networkError) {
    const error = new Error(`Failed to reach GitHub API while resolving commit SHA: ${networkError.message}`);
    error.statusCode = 502;
    throw error;
  }

  if (response.status === 403 || response.status === 429) {
    const error = new Error('GitHub API rate limit exceeded while resolving commit SHA.');
    error.statusCode = 429;
    throw error;
  }

  if (response.status === 404) {
    const error = new Error(
      `Branch "${branch}" was not found in repository "${owner}/${repo}" on GitHub.`
    );
    error.statusCode = 404;
    throw error;
  }

  if (!response.ok) {
    const error = new Error(`GitHub API returned unexpected status ${response.status} while resolving commit SHA.`);
    error.statusCode = response.status >= 500 ? 502 : response.status;
    throw error;
  }

  const data = await response.json();
  const sha = data && data.sha;
  if (!sha || typeof sha !== 'string' || sha.length !== 40) {
    const error = new Error('GitHub API returned an unexpected commit SHA format.');
    error.statusCode = 502;
    throw error;
  }

  return sha;
};

module.exports = {
  fetchPublicRepositoryMetadata,
  resolveCommitSha,
};
