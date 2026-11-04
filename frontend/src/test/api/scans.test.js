/**
 * Scan API module tests.
 * Verifies endpoint paths, request payloads, response handling, and error propagation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createScan, getScan, getRepositoryScans } from '../../api/scans.js';

// Mock the api client module
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

const REPO_ID = 'repo-abc-123';
const SCAN_ID = 'scan-xyz-456';

describe('scans API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── createScan ──────────────────────────────────────────────

  describe('createScan', () => {
    it('POSTs to /repositories/:id/scans with empty body', async () => {
      const mockResponse = {
        success: true,
        message: 'Scan queued successfully.',
        scan: { _id: SCAN_ID, status: 'QUEUED', repositoryId: REPO_ID },
      };
      api.post.mockResolvedValue(mockResponse);

      const result = await createScan(REPO_ID);

      expect(api.post).toHaveBeenCalledWith(
        `/repositories/${REPO_ID}/scans`,
        {},
        { signal: undefined }
      );
      expect(result).toEqual(mockResponse);
    });

    it('passes AbortSignal through to api.post', async () => {
      const controller = new AbortController();
      api.post.mockResolvedValue({
        success: true,
        message: 'Scan queued successfully.',
        scan: { _id: SCAN_ID, status: 'QUEUED' },
      });

      await createScan(REPO_ID, controller.signal);

      expect(api.post).toHaveBeenCalledWith(
        `/repositories/${REPO_ID}/scans`,
        {},
        { signal: controller.signal }
      );
    });

    it('propagates 409 SCAN_ALREADY_IN_PROGRESS ApiError', async () => {
      api.post.mockRejectedValue(
        new ApiError(
          'A scan is already in progress for this repository.',
          409,
          'SCAN_ALREADY_IN_PROGRESS'
        )
      );

      const err = await createScan(REPO_ID).catch((e) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect(err.status).toBe(409);
      expect(err.code).toBe('SCAN_ALREADY_IN_PROGRESS');
      expect(err.message).toMatch(/already in progress/i);
    });

    it('propagates 404 ApiError when repository is not found', async () => {
      api.post.mockRejectedValue(
        new ApiError('Repository not found.', 404)
      );

      await expect(createScan(REPO_ID)).rejects.toThrow('Repository not found.');
    });

    it('propagates network error (status 0)', async () => {
      api.post.mockRejectedValue(
        new ApiError('Unable to reach the server. Please check your connection.', 0)
      );

      const err = await createScan(REPO_ID).catch((e) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect(err.status).toBe(0);
    });
  });

  // ─── getScan ─────────────────────────────────────────────────

  describe('getScan', () => {
    it('GETs /repositories/:repositoryId/scans/:scanId', async () => {
      const mockResponse = {
        success: true,
        scan: { _id: SCAN_ID, status: 'RUNNING', repositoryId: REPO_ID },
      };
      api.get.mockResolvedValue(mockResponse);

      const result = await getScan(REPO_ID, SCAN_ID);

      expect(api.get).toHaveBeenCalledWith(
        `/repositories/${REPO_ID}/scans/${SCAN_ID}`,
        { signal: undefined }
      );
      expect(result).toEqual(mockResponse);
    });

    it('passes AbortSignal through to api.get', async () => {
      const controller = new AbortController();
      api.get.mockResolvedValue({ success: true, scan: { _id: SCAN_ID, status: 'COMPLETED' } });

      await getScan(REPO_ID, SCAN_ID, controller.signal);

      expect(api.get).toHaveBeenCalledWith(
        `/repositories/${REPO_ID}/scans/${SCAN_ID}`,
        { signal: controller.signal }
      );
    });

    it('propagates 404 when scan is not found', async () => {
      api.get.mockRejectedValue(new ApiError('Scan not found.', 404));

      await expect(getScan(REPO_ID, SCAN_ID)).rejects.toThrow('Scan not found.');
    });

    it('propagates 401 when session is not authenticated', async () => {
      api.get.mockRejectedValue(
        new ApiError('Authentication required. Please log in.', 401)
      );

      const err = await getScan(REPO_ID, SCAN_ID).catch((e) => e);
      expect(err.status).toBe(401);
    });
  });

  // ─── getRepositoryScans ───────────────────────────────────────

  describe('getRepositoryScans', () => {
    it('GETs /repositories/:repositoryId/scans with default pagination', async () => {
      const mockResponse = {
        success: true,
        scans: [{ _id: SCAN_ID, status: 'COMPLETED' }],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      };
      api.get.mockResolvedValue(mockResponse);

      const result = await getRepositoryScans(REPO_ID);

      expect(api.get).toHaveBeenCalledWith(
        `/repositories/${REPO_ID}/scans?page=1&limit=20`,
        { signal: undefined }
      );
      expect(result).toEqual(mockResponse);
    });

    it('applies custom page and limit params', async () => {
      api.get.mockResolvedValue({
        success: true,
        scans: [],
        total: 0,
        page: 2,
        limit: 5,
        totalPages: 0,
      });

      await getRepositoryScans(REPO_ID, { page: 2, limit: 5 });

      expect(api.get).toHaveBeenCalledWith(
        `/repositories/${REPO_ID}/scans?page=2&limit=5`,
        { signal: undefined }
      );
    });

    it('passes AbortSignal through to api.get', async () => {
      const controller = new AbortController();
      api.get.mockResolvedValue({
        success: true,
        scans: [],
        total: 0,
        page: 1,
        limit: 1,
        totalPages: 0,
      });

      await getRepositoryScans(REPO_ID, { limit: 1 }, controller.signal);

      expect(api.get).toHaveBeenCalledWith(
        `/repositories/${REPO_ID}/scans?page=1&limit=1`,
        { signal: controller.signal }
      );
    });

    it('propagates ApiError on failure', async () => {
      api.get.mockRejectedValue(
        new ApiError('Authentication required. Please log in.', 401)
      );

      await expect(getRepositoryScans(REPO_ID)).rejects.toThrow(
        'Authentication required. Please log in.'
      );
    });
  });
});

