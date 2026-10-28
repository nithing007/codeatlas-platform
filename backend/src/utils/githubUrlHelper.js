/**
 * GitHub URL Validation and Normalization Utility
 * Parses, validates, and normalizes GitHub repository URLs.
 */

const RESERVED_GITHUB_PATHS = new Set([
  'about',
  'account',
  'contact',
  'customer-stories',
  'enterprise',
  'events',
  'explore',
  'features',
  'insights',
  'issues',
  'join',
  'login',
  'marketplace',
  'mobile',
  'new',
  'nonprofit',
  'notifications',
  'organizations',
  'orgs',
  'password_reset',
  'pricing',
  'pulls',
  'readme',
  'search',
  'security',
  'session',
  'settings',
  'site',
  'sponsors',
  'stars',
  'team',
  'topics',
  'trending',
  'users',
  'watching',
]);

const GITHUB_USERNAME_REGEX = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;
const GITHUB_REPO_REGEX = /^[a-zA-Z0-9_.-]{1,100}$/;

/**
 * Parses and validates a GitHub repository URL.
 *
 * Accepted examples:
 *   - https://github.com/owner/repository
 *   - https://github.com/owner/repository/
 *   - https://github.com/owner/repository.git
 *   - http://github.com/owner/repository
 *
 * Rejected examples:
 *   - Non-GitHub URLs (https://gitlab.com/owner/repo, https://google.com)
 *   - Profile / Org URLs (https://github.com/owner)
 *   - Sub-paths (https://github.com/owner/repo/issues/1, https://github.com/owner/repo/tree/main)
 *   - Reserved paths (https://github.com/pricing)
 *   - Malformed strings
 *
 * @param {string} rawUrl - The input URL string to validate.
 * @returns {{ owner: string, repo: string, fullName: string, normalizedUrl: string }}
 * @throws {Error} 400 Bad Request error if the URL is invalid.
 */
const parseGitHubRepoUrl = (rawUrl) => {
  if (!rawUrl || typeof rawUrl !== 'string') {
    const error = new Error('Repository URL is required and must be a string.');
    error.statusCode = 400;
    throw error;
  }

  const trimmed = rawUrl.trim();

  if (!trimmed) {
    const error = new Error('Repository URL cannot be empty.');
    error.statusCode = 400;
    throw error;
  }

  // Ensure protocol is present for URL parser
  let urlToParse = trimmed;
  if (!/^https?:\/\//i.test(urlToParse)) {
    urlToParse = `https://${urlToParse}`;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(urlToParse);
  } catch {
    const error = new Error('Invalid URL format. Please provide a valid GitHub repository URL.');
    error.statusCode = 400;
    throw error;
  }

  // Validate Hostname
  const hostname = parsedUrl.hostname.toLowerCase();
  if (hostname !== 'github.com' && hostname !== 'www.github.com') {
    const error = new Error('Only GitHub repository URLs are supported (e.g. https://github.com/owner/repo).');
    error.statusCode = 400;
    throw error;
  }

  // Sanitize and normalize pathname
  let pathname = parsedUrl.pathname.trim();

  // Strip leading and trailing slashes
  pathname = pathname.replace(/^\/+|\/+$/g, '');

  // Strip .git suffix if present
  if (pathname.endsWith('.git')) {
    pathname = pathname.slice(0, -4);
  }

  const segments = pathname.split('/').filter(Boolean);

  if (segments.length < 2) {
    const error = new Error(
      'Invalid repository URL. Please provide a full repository URL containing both owner and repository name (e.g. https://github.com/owner/repository).'
    );
    error.statusCode = 400;
    throw error;
  }

  if (segments.length > 2) {
    const error = new Error(
      'Invalid repository URL. URLs pointing to issues, pull requests, branches, or files are not accepted. Please provide the root repository URL (e.g. https://github.com/owner/repository).'
    );
    error.statusCode = 400;
    throw error;
  }

  const [owner, repo] = segments;

  if (RESERVED_GITHUB_PATHS.has(owner.toLowerCase())) {
    const error = new Error(`"${owner}" is a reserved GitHub path, not a valid repository owner.`);
    error.statusCode = 400;
    throw error;
  }

  if (!GITHUB_USERNAME_REGEX.test(owner)) {
    const error = new Error(`Invalid GitHub repository owner name: "${owner}".`);
    error.statusCode = 400;
    throw error;
  }

  if (!GITHUB_REPO_REGEX.test(repo) || repo === '.' || repo === '..') {
    const error = new Error(`Invalid GitHub repository name: "${repo}".`);
    error.statusCode = 400;
    throw error;
  }

  const fullName = `${owner}/${repo}`;
  const normalizedUrl = `https://github.com/${fullName}`;

  return {
    owner,
    repo,
    fullName,
    normalizedUrl,
  };
};

module.exports = {
  parseGitHubRepoUrl,
};
