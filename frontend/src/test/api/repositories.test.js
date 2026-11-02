/**
 * Repository API module tests.
 * Verifies endpoint paths, request payloads, response handling, and error propagation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getRepositories,
  addRepository,
  previewRepository,
} from '../../api/repositories.js';

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

describe('repositories API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getRepositories', () => {
    it('GETs /repositories', async () => {
      const mockData = {
        success: true,
        count: 2,
        repositories: [
          { _id: '1', name: 'repo-one', fullName: 'owner/repo-one' },
          { _id: '2', name: 'repo-two', fullName: 'owner/repo-two' },
        ],
      };
      api.get.mockResolvedValue(mockData);

      const result = await getRepositories();

      expect(api.get).toHaveBeenCalledWith('/repositories', { signal: undefined });
      expect(result).toEqual(mockData);
    });

    it('propagates AbortSignal to GET /repositories', async () => {
      const controller = new AbortController();
      api.get.mockResolvedValue({ success: true, count: 0, repositories: [] });

      await getRepositories(controller.signal);

      expect(api.get).toHaveBeenCalledWith('/repositories', {
        signal: controller.signal,
      });
    });

    it('propagates ApiError on failure', async () => {
      api.get.mockRejectedValue(new ApiError('Authentication required. Please log in.', 401));

      await expect(getRepositories()).rejects.toThrow(
        'Authentication required. Please log in.'
      );
    });
  });

  describe('addRepository', () => {
    it('POSTs /repositories with repositoryUrl payload', async () => {
      const mockResponse = {
        success: true,
        message: 'Repository imported successfully.',
        repository: {
          _id: '123',
          fullName: 'facebook/react',
        },
      };
      api.post.mockResolvedValue(mockResponse);

      const result = await addRepository('https://github.com/facebook/react');

      expect(api.post).toHaveBeenCalledWith(
        '/repositories',
        { repositoryUrl: 'https://github.com/facebook/react' },
        { signal: undefined }
      );
      expect(result).toEqual(mockResponse);
    });

    it('propagates backend 409 conflict error when duplicate', async () => {
      api.post.mockRejectedValue(
        new ApiError(
          'Repository "facebook/react" has already been imported into your account.',
          409
        )
      );

      await expect(
        addRepository('https://github.com/facebook/react')
      ).rejects.toThrow('Repository "facebook/react" has already been imported into your account.');
    });

    it('propagates backend 404 error when repo does not exist', async () => {
      api.post.mockRejectedValue(
        new ApiError('Repository "owner/notfound" was not found on GitHub or is private.', 404)
      );

      await expect(
        addRepository('https://github.com/owner/notfound')
      ).rejects.toThrow('was not found on GitHub or is private');
    });
  });

  describe('previewRepository', () => {
    it('POSTs /repositories/preview with repositoryUrl payload', async () => {
      const mockPreview = {
        success: true,
        repository: {
          name: 'react',
          fullName: 'facebook/react',
          stars: 200000,
        },
      };
      api.post.mockResolvedValue(mockPreview);

      const result = await previewRepository('https://github.com/facebook/react');

      expect(api.post).toHaveBeenCalledWith(
        '/repositories/preview',
        { repositoryUrl: 'https://github.com/facebook/react' },
        { signal: undefined }
      );
      expect(result).toEqual(mockPreview);
    });
  });
});
