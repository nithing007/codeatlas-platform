/**
 * useEmailOtp — manages the two-step Email OTP authentication flow.
 *
 * Step 1: Email entry → POST /auth/request-otp
 * Step 2: OTP entry  → POST /auth/verify-otp → sets HttpOnly cookie
 *
 * Rules derived from the backend:
 * - OTP is 6 digits, expires in 5 minutes (config.otpExpiresMinutes).
 * - Resend cooldown is 60 seconds (config.otpResendCooldownSeconds).
 * - Max attempts: 5 (config.otpMaxAttempts).
 * - Backend returns 429 when the cooldown is active.
 * - Backend returns 401 for invalid/expired/exhausted OTPs.
 * - Never store OTPs in browser storage.
 */

import { useCallback, useRef, useState } from 'react';
import { requestOtp as apiRequestOtp, verifyOtp as apiVerifyOtp } from '../api/auth.js';
import { ApiError } from '../api/client.js';

// Simple email format check — mirrors the backend regex /^\S+@\S+\.\S+$/
const isValidEmail = (email) => /^\S+@\S+\.\S+$/.test(email.trim());

export function useEmailOtp() {
  const [step, setStep] = useState('email'); // 'email' | 'otp'
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [otpError, setOtpError] = useState('');
  const [requestError, setRequestError] = useState('');
  const [isRequestingOtp, setIsRequestingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const requestController = useRef(null);
  const verifyController = useRef(null);

  // ── Step 1: Request OTP ────────────────────────────────────────────────

  const handleRequestOtp = useCallback(
    async (emailValue) => {
      const trimmed = emailValue.trim();

      // Client-side email validation
      if (!trimmed) {
        setEmailError('Email address is required');
        return;
      }
      if (!isValidEmail(trimmed)) {
        setEmailError('Please enter a valid email address');
        return;
      }

      setEmailError('');
      setRequestError('');
      setSuccessMessage('');

      // Cancel any pending previous request
      if (requestController.current) {
        requestController.current.abort();
      }
      requestController.current = new AbortController();

      setIsRequestingOtp(true);
      try {
        const result = await apiRequestOtp(trimmed, requestController.current.signal);
        setEmail(trimmed);
        setSuccessMessage(result.message || 'Verification code sent to your email');
        setStep('otp');
      } catch (err) {
        if (err.name === 'AbortError') return;
        if (err instanceof ApiError) {
          setRequestError(err.message);
        } else {
          setRequestError('Something went wrong. Please try again.');
        }
      } finally {
        setIsRequestingOtp(false);
      }
    },
    []
  );

  // ── Resend OTP (same as request, but from otp step) ─────────────────

  const handleResendOtp = useCallback(async () => {
    setOtpError('');
    setRequestError('');
    setSuccessMessage('');
    await handleRequestOtp(email);
  }, [email, handleRequestOtp]);

  // ── Step 2: Verify OTP ────────────────────────────────────────────────

  /**
   * @param {string} otpValue   6-digit string
   * @returns {Promise<{ user: object, isNewUser: boolean } | null>}
   *          Returns the result on success, null on error.
   */
  const handleVerifyOtp = useCallback(async (otpValue) => {
    const trimmed = otpValue.trim();

    if (!trimmed) {
      setOtpError('Verification code is required');
      return null;
    }
    if (!/^\d{6}$/.test(trimmed)) {
      setOtpError('Please enter the 6-digit code from your email');
      return null;
    }

    setOtpError('');
    setRequestError('');

    // Cancel any pending verification
    if (verifyController.current) {
      verifyController.current.abort();
    }
    verifyController.current = new AbortController();

    setIsVerifyingOtp(true);
    try {
      const result = await apiVerifyOtp(email, trimmed, verifyController.current.signal);
      return result; // { success, user, isNewUser }
    } catch (err) {
      if (err.name === 'AbortError') return null;
      if (err instanceof ApiError) {
        setOtpError(err.message);
      } else {
        setOtpError('Something went wrong. Please try again.');
      }
      return null;
    } finally {
      setIsVerifyingOtp(false);
    }
  }, [email]);

  // ── Navigation ────────────────────────────────────────────────────────

  const goBackToEmail = useCallback(() => {
    setStep('email');
    setOtpError('');
    setRequestError('');
    setSuccessMessage('');
  }, []);

  return {
    step,
    email,
    emailError,
    otpError,
    requestError,
    isRequestingOtp,
    isVerifyingOtp,
    successMessage,
    handleRequestOtp,
    handleVerifyOtp,
    handleResendOtp,
    goBackToEmail,
  };
}

