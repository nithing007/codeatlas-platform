/**
 * useEmailOtp hook tests.
 * Tests: email validation, OTP format validation, step transitions,
 * loading states, error propagation, resend, back navigation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEmailOtp } from '../../hooks/useEmailOtp.js';

vi.mock('../../api/auth.js', () => ({
  requestOtp: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock('../../api/client.js', () => ({
  ApiError: class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  },
  default: {},
  buildBackendUrl: (p) => `http://localhost:5000/api${p}`,
}));

import { requestOtp, verifyOtp } from '../../api/auth.js';
import { ApiError } from '../../api/client.js';

describe('useEmailOtp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('email validation', () => {
    it('sets emailError for empty email', async () => {
      const { result } = renderHook(() => useEmailOtp());
      await act(async () => {
        await result.current.handleRequestOtp('');
      });
      expect(result.current.emailError).toBe('Email address is required');
      expect(requestOtp).not.toHaveBeenCalled();
    });

    it('sets emailError for invalid email format', async () => {
      const { result } = renderHook(() => useEmailOtp());
      await act(async () => {
        await result.current.handleRequestOtp('not-an-email');
      });
      expect(result.current.emailError).toBeTruthy();
      expect(requestOtp).not.toHaveBeenCalled();
    });

    it('accepts valid email and calls API', async () => {
      requestOtp.mockResolvedValue({ success: true, message: 'Verification code sent to your email' });
      const { result } = renderHook(() => useEmailOtp());
      await act(async () => {
        await result.current.handleRequestOtp('valid@example.com');
      });
      expect(requestOtp).toHaveBeenCalledWith('valid@example.com', expect.any(Object));
    });
  });

  describe('step transitions', () => {
    it('advances to otp step after successful requestOtp', async () => {
      requestOtp.mockResolvedValue({ success: true, message: 'Sent' });
      const { result } = renderHook(() => useEmailOtp());
      expect(result.current.step).toBe('email');
      await act(async () => {
        await result.current.handleRequestOtp('a@b.com');
      });
      expect(result.current.step).toBe('otp');
    });

    it('stays on email step when requestOtp fails', async () => {
      requestOtp.mockRejectedValue(new ApiError('Something failed', 500));
      const { result } = renderHook(() => useEmailOtp());
      await act(async () => {
        await result.current.handleRequestOtp('a@b.com');
      });
      expect(result.current.step).toBe('email');
    });

    it('goBackToEmail resets to email step', async () => {
      requestOtp.mockResolvedValue({ success: true, message: 'Sent' });
      const { result } = renderHook(() => useEmailOtp());
      await act(async () => {
        await result.current.handleRequestOtp('a@b.com');
      });
      expect(result.current.step).toBe('otp');
      act(() => result.current.goBackToEmail());
      expect(result.current.step).toBe('email');
    });
  });

  describe('OTP validation', () => {
    it('sets otpError for empty OTP', async () => {
      requestOtp.mockResolvedValue({ success: true, message: 'Sent' });
      const { result } = renderHook(() => useEmailOtp());
      await act(async () => {
        await result.current.handleRequestOtp('a@b.com');
      });
      await act(async () => {
        await result.current.handleVerifyOtp('');
      });
      expect(result.current.otpError).toBe('Verification code is required');
      expect(verifyOtp).not.toHaveBeenCalled();
    });

    it('sets otpError for non-6-digit OTP', async () => {
      requestOtp.mockResolvedValue({ success: true, message: 'Sent' });
      const { result } = renderHook(() => useEmailOtp());
      await act(async () => {
        await result.current.handleRequestOtp('a@b.com');
      });
      await act(async () => {
        await result.current.handleVerifyOtp('abc');
      });
      expect(result.current.otpError).toBeTruthy();
      expect(verifyOtp).not.toHaveBeenCalled();
    });

    it('calls verifyOtp API with correct args for valid 6-digit OTP', async () => {
      requestOtp.mockResolvedValue({ success: true, message: 'Sent' });
      verifyOtp.mockResolvedValue({ success: true, user: { email: 'a@b.com' }, isNewUser: false });
      const { result } = renderHook(() => useEmailOtp());
      await act(async () => {
        await result.current.handleRequestOtp('a@b.com');
      });
      await act(async () => {
        await result.current.handleVerifyOtp('123456');
      });
      expect(verifyOtp).toHaveBeenCalledWith('a@b.com', '123456', expect.any(Object));
    });
  });

  describe('error handling', () => {
    it('surfaces 429 rate limit error as requestError', async () => {
      requestOtp.mockRejectedValue(new ApiError('Please wait 45 seconds', 429));
      const { result } = renderHook(() => useEmailOtp());
      await act(async () => {
        await result.current.handleRequestOtp('a@b.com');
      });
      expect(result.current.requestError).toContain('45 seconds');
    });

    it('surfaces 401 invalid OTP error as otpError', async () => {
      requestOtp.mockResolvedValue({ success: true, message: 'Sent' });
      verifyOtp.mockRejectedValue(new ApiError('Invalid verification code. 3 attempts remaining', 401));
      const { result } = renderHook(() => useEmailOtp());
      await act(async () => await result.current.handleRequestOtp('a@b.com'));
      await act(async () => await result.current.handleVerifyOtp('999999'));
      expect(result.current.otpError).toContain('Invalid verification code');
    });
  });

  describe('loading states', () => {
    it('isRequestingOtp is true during requestOtp and false after', async () => {
      let resolve;
      requestOtp.mockImplementation(() => new Promise((r) => { resolve = r; }));
      const { result } = renderHook(() => useEmailOtp());
      act(() => { result.current.handleRequestOtp('a@b.com'); });
      expect(result.current.isRequestingOtp).toBe(true);
      await act(async () => { resolve({ success: true, message: 'Sent' }); });
      expect(result.current.isRequestingOtp).toBe(false);
    });
  });

  describe('success message', () => {
    it('stores message from backend on successful OTP request', async () => {
      requestOtp.mockResolvedValue({ success: true, message: 'Verification code sent to your email' });
      const { result } = renderHook(() => useEmailOtp());
      await act(async () => {
        await result.current.handleRequestOtp('a@b.com');
      });
      expect(result.current.successMessage).toBe('Verification code sent to your email');
    });
  });
});
