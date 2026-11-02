/**
 * Repository API module.
 * Wraps backend /api/repositories/* endpoints.
 *
 * Endpoints:
 *   GET  /api/repositories         — List authenticated user's repositories
 *   POST /api/repositories         — Import a public GitHub repository
 *   POST /api/repositories/preview — Preview repository metadata without saving
 */

import api from './client.js';

/**
 * Fetch all repositories belonging to the authenticated user.
 *
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ success: boolean, count: number, repositories: Array<object> }>}
 */
export async function getRepositories(signal) {
  return api.get('/repositories', { signal });
}

/**
 * Import a public GitHub repository into the authenticated user's account.
 *
 * @param {string} repositoryUrl - The public GitHub repository URL.
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ success: boolean, message: string, repository: object }>}
 */
export async function addRepository(repositoryUrl, signal) {
  return api.post('/repositories', { repositoryUrl }, { signal });
}

/**
 * Preview public repository metadata from GitHub without importing.
 *
 * @param {string} repositoryUrl - The public GitHub repository URL.
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ success: boolean, repository: object }>}
 */
export async function previewRepository(repositoryUrl, signal) {
  return api.post('/repositories/preview', { repositoryUrl }, { signal });
}
