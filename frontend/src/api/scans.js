/**
 * Scan API service for CodeAtlas frontend.
 *
 * Endpoints (all protected — requires auth cookie):
 *   POST /repositories/:id/scans                       — create scan
 *   GET  /repositories/:repositoryId/scans/:scanId     — get scan by ID
 *   GET  /repositories/:repositoryId/scans             — list scans (paginated)
 *
 * Error codes from backend:
 *   SCAN_ALREADY_IN_PROGRESS  (409) — a scan is already QUEUED or RUNNING
 */

import api from './client.js';

/**
 * Start a new scan for a repository.
 * Returns immediately (HTTP 201); execution runs asynchronously.
 *
 * @param {string}       repositoryId  Repository _id.
 * @param {AbortSignal}  [signal]      Optional AbortSignal.
 * @returns {Promise<{ success: true, message: string, scan: object }>}
 * @throws {ApiError}  409 SCAN_ALREADY_IN_PROGRESS if a scan is active.
 */
export async function createScan(repositoryId, signal) {
  return api.post(`/repositories/${repositoryId}/scans`, {}, { signal });
}

/**
 * Fetch a single scan by its ID.
 *
 * @param {string}       repositoryId  Repository _id.
 * @param {string}       scanId        Scan _id.
 * @param {AbortSignal}  [signal]      Optional AbortSignal.
 * @returns {Promise<{ success: true, scan: object }>}
 */
export async function getScan(repositoryId, scanId, signal) {
  return api.get(`/repositories/${repositoryId}/scans/${scanId}`, { signal });
}

/**
 * List scans for a repository, sorted newest first.
 * Useful for recovering an active scan after page refresh.
 *
 * @param {string}       repositoryId        Repository _id.
 * @param {{ page?: number, limit?: number }} [params]
 * @param {AbortSignal}  [signal]            Optional AbortSignal.
 * @returns {Promise<{ success: true, scans: object[], total: number, page: number, limit: number, totalPages: number }>}
 */
export async function getRepositoryScans(repositoryId, { page = 1, limit = 20 } = {}, signal) {
  return api.get(
    `/repositories/${repositoryId}/scans?page=${page}&limit=${limit}`,
    { signal }
  );
}

