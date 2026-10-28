/**
 * API client unit tests.
 * Tests: credentialed requests, error normalization, status codes, network errors.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import api, { ApiError, buildBackendUrl } from '../../api/client.js';

// Mock the global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock import.meta.env
vi.stubGlobal('import', {
  meta: { env: { VITE_API_BASE_URL: 'http://localhost:5000/api' } },
});

function makeResponse(body, status = 200, ok = true) {
  return {
    ok,
    status,
    headers: { get: () => 'application/json' },
    json: vi.fn().mockResolvedValue(body),
  };
}

function makeErrorResponse(body, status) {
  return makeResponse(body, status, false);
}

describe('API client', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('buildBackendUrl', () => {
    it('prefixes with base URL', () => {
      const url = buildBackendUrl('/auth/me');
      expect(url).toBe('http://localhost:5000/api/auth/me');
    });
  });

  describe('credentials', () => {
    it('sends credentials: include on every request', async () => {
      mockFetch.mockResolvedValue(makeResponse({ success: true }));
      await api.get('/auth/me');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ credentials: 'include' })
      );
    });
  });

  describe('GET', () => {
    it('returns parsed JSON on success', async () => {
      mockFetch.mockResolvedValue(makeResponse({ success: true, user: { email: 'a@b.com' } }));
      const result = await api.get('/auth/me');
      expect(result.success).toBe(true);
      expect(result.user.email).toBe('a@b.com');
    });
  });

  describe('POST', () => {
    it('sends JSON body', async () => {
      mockFetch.mockResolvedValue(makeResponse({ success: true }));
      await api.post('/auth/request-otp', { email: 'a@b.com' });
      const call = mockFetch.mock.calls[0];
      expect(call[1].method).toBe('POST');
      expect(call[1].body).toBe(JSON.stringify({ email: 'a@b.com' }));
    });
  });

  describe('error normalization', () => {
    it('throws ApiError with message from plain string error body', async () => {
      mockFetch.mockResolvedValue(
        makeErrorResponse({ success: false, error: 'Invalid email' }, 400)
      );
      await expect(api.post('/auth/request-otp', { email: 'bad' })).rejects.toMatchObject({
        name: 'ApiError',
        status: 400,
        message: 'Invalid email',
      });
    });

    it('throws ApiError with message from structured error body', async () => {
      mockFetch.mockResolvedValue(
        makeErrorResponse(
          { success: false, error: { code: 'OTP_EXPIRED', message: 'Code has expired' } },
          401
        )
      );
      const err = await api.post('/auth/verify-otp', {}).catch((e) => e);
      expect(err.message).toBe('Code has expired');
      expect(err.code).toBe('OTP_EXPIRED');
      expect(err.status).toBe(401);
    });

    it('throws ApiError with status 401 for unauthorized', async () => {
      mockFetch.mockResolvedValue(
        makeErrorResponse({ success: false, error: 'Authentication required' }, 401)
      );
      const err = await api.get('/auth/me').catch((e) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect(err.status).toBe(401);
    });

    it('throws ApiError with status 429 for rate limiting', async () => {
      mockFetch.mockResolvedValue(
        makeErrorResponse({ success: false, error: 'Please wait 45 seconds' }, 429)
      );
      const err = await api.post('/auth/request-otp', {}).catch((e) => e);
      expect(err.status).toBe(429);
      expect(err.message).toContain('45 seconds');
    });

    it('throws ApiError with status 500 for server errors', async () => {
      mockFetch.mockResolvedValue(
        makeErrorResponse({ success: false, error: 'Internal Server Error' }, 500)
      );
      const err = await api.get('/auth/me').catch((e) => e);
      expect(err.status).toBe(500);
    });

    it('throws ApiError with status 0 for network errors', async () => {
      mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));
      const err = await api.get('/auth/me').catch((e) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect(err.status).toBe(0);
      expect(err.message).toContain('Unable to reach the server');
    });
  });

  describe('AbortSignal', () => {
    it('passes signal to fetch', async () => {
      mockFetch.mockResolvedValue(makeResponse({ success: true }));
      const controller = new AbortController();
      await api.get('/auth/me', { signal: controller.signal });
      const call = mockFetch.mock.calls[0];
      expect(call[1].signal).toBe(controller.signal);
    });
  });
});
