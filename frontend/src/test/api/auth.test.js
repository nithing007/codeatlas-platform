/**
 * Auth API module tests.
 * Verifies correct endpoint paths, request shapes, and Google OAuth URL.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestOtp, verifyOtp, getGoogleAuthUrl, logout, getMe } from '../../api/auth.js';

// Mock the api client module
vi.mock('../../api/client.js', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
  buildBackendUrl: (path) => `http://localhost:5000/api${path}`,
  ApiError: class ApiError extends Error {
    constructor(message, status, code = null) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
    }
  },
}));

import api from '../../api/client.js';

describe('auth API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('requestOtp', () => {
    it('POSTs to /auth/request-otp with email', async () => {
      api.post.mockResolvedValue({ success: true, message: 'Verification code sent to your email' });
      await requestOtp('test@example.com');
      expect(api.post).toHaveBeenCalledWith(
        '/auth/request-otp',
        { email: 'test@example.com' },
        expect.any(Object)
      );
    });
  });

  describe('verifyOtp', () => {
    it('POSTs to /auth/verify-otp with email and otp', async () => {
      api.post.mockResolvedValue({ success: true, user: {}, isNewUser: false });
      await verifyOtp('test@example.com', '123456');
      expect(api.post).toHaveBeenCalledWith(
        '/auth/verify-otp',
        { email: 'test@example.com', otp: '123456' },
        expect.any(Object)
      );
    });
  });

  describe('getGoogleAuthUrl', () => {
    it('returns the backend Google auth URL for browser navigation', () => {
      const url = getGoogleAuthUrl();
      expect(url).toBe('http://localhost:5000/api/auth/google');
    });

    it('does not make a fetch call — is a URL builder only', () => {
      getGoogleAuthUrl();
      expect(api.get).not.toHaveBeenCalled();
      expect(api.post).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('POSTs to /auth/logout', async () => {
      api.post.mockResolvedValue({ success: true, message: 'Logged out successfully' });
      await logout();
      expect(api.post).toHaveBeenCalledWith(
        '/auth/logout',
        {},
        expect.any(Object)
      );
    });
  });

  describe('getMe', () => {
    it('GETs /auth/me', async () => {
      api.get.mockResolvedValue({ success: true, user: { email: 'a@b.com' } });
      const result = await getMe();
      expect(api.get).toHaveBeenCalledWith('/auth/me', expect.any(Object));
      expect(result.user.email).toBe('a@b.com');
    });
  });
});

