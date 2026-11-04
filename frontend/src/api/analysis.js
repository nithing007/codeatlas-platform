/**
 * Analysis API service for CodeAtlas frontend.
 *
 * Endpoints (all protected — requires auth cookie):
 *   GET /repositories/:repositoryId/scans/:scanId/analysis — get analysis result for a scan
 *
 * Error codes from backend:
 *   SCAN_NOT_COMPLETED  (400) — scan is QUEUED or RUNNING
 *   SCAN_FAILED         (400) — scan failed, no analysis available
 *   ANALYSIS_NOT_FOUND  (404) — analysis result missing for a completed scan
 */

import api from './client.js';

/**
 * Retrieve the persisted analysis result for a specific completed scan.
 *
 * @param {string}       repositoryId  Repository _id.
 * @param {string}       scanId        Scan _id.
 * @param {AbortSignal}  [signal]      Optional AbortSignal.
 * @returns {Promise<{ success: true, analysis: object }>}
 * @throws {ApiError}  400 SCAN_NOT_COMPLETED if scan is QUEUED or RUNNING.
 * @throws {ApiError}  400 SCAN_FAILED if scan failed.
 * @throws {ApiError}  404 if repository, scan, or analysis result is not found.
 */
export async function getScanAnalysis(repositoryId, scanId, signal) {
  return api.get(
    `/repositories/${repositoryId}/scans/${scanId}/analysis`,
    { signal }
  );
}

