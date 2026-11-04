/**
 * Analysis API service tests.
 * Verifies getScanAnalysis hits the correct URL and propagates errors.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getScanAnalysis } from '../../api/analysis.js';

vi.mock('../../api/client.js', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(message, status, code = null) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
    }
  },
}));

import api, { ApiError } from '../../api/client.js';

const REPO_ID = 'repo-abc123';
const SCAN_ID = 'scan-def456';

describe('getScanAnalysis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls the correct URL for a given repositoryId and scanId', async () => {
    const mockData = { success: true, analysis: { _id: 'result-1', analyzerVersion: '1.0.0' } };
    api.get.mockResolvedValueOnce(mockData);

    const result = await getScanAnalysis(REPO_ID, SCAN_ID);

    expect(api.get).toHaveBeenCalledWith(
      `/repositories/${REPO_ID}/scans/${SCAN_ID}/analysis`,
      { signal: undefined }
    );
    expect(result).toEqual(mockData);
  });

  it('passes AbortSignal through to api.get', async () => {
    api.get.mockResolvedValueOnce({ success: true, analysis: {} });
    const controller = new AbortController();

    await getScanAnalysis(REPO_ID, SCAN_ID, controller.signal);

    expect(api.get).toHaveBeenCalledWith(
      `/repositories/${REPO_ID}/scans/${SCAN_ID}/analysis`,
      { signal: controller.signal }
    );
  });

  it('propagates 404 ApiError when scan or analysis is not found', async () => {
    const err = new ApiError('Scan not found.', 404, 'ANALYSIS_NOT_FOUND');
    api.get.mockRejectedValueOnce(err);

    await expect(getScanAnalysis(REPO_ID, SCAN_ID)).rejects.toThrow('Scan not found.');
  });

  it('propagates 400 ApiError when scan is not completed', async () => {
    const err = new ApiError('Analysis is not ready. Scan is currently RUNNING.', 400, 'SCAN_NOT_COMPLETED');
    api.get.mockRejectedValueOnce(err);

    await expect(getScanAnalysis(REPO_ID, SCAN_ID)).rejects.toMatchObject({
      status: 400,
      code: 'SCAN_NOT_COMPLETED',
    });
  });

  it('propagates 400 ApiError when scan failed', async () => {
    const err = new ApiError('Analysis is not available because the scan failed.', 400, 'SCAN_FAILED');
    api.get.mockRejectedValueOnce(err);

    await expect(getScanAnalysis(REPO_ID, SCAN_ID)).rejects.toMatchObject({
      status: 400,
      code: 'SCAN_FAILED',
    });
  });

  it('propagates network errors', async () => {
    api.get.mockRejectedValueOnce(new Error('Network error'));

    await expect(getScanAnalysis(REPO_ID, SCAN_ID)).rejects.toThrow('Network error');
  });
});

