/**
 * Login page — Email OTP and Google OAuth authentication.
 *
 * Google OAuth flow:
 *   The browser navigates to GET /api/auth/google.
 *   The backend generates state, sets an HttpOnly oauth_state cookie,
 *   and issues a 302 redirect to Google's consent screen.
 *   After consent, Google redirects to /api/auth/google/callback.
 *   The backend validates state, sets the auth cookie, then redirects to
 *   CLIENT_URL (http://localhost:5173), which re-runs the session check.
 *
 * We use window.location.href (not fetch) for the Google redirect so the
 * browser follows the chain of server-side redirects and cookies are set correctly.
 */

import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useEmailOtp } from '../../hooks/useEmailOtp.js';
import { getGoogleAuthUrl } from '../../api/auth.js';
import { Button } from '../../components/ui/Button.jsx';
import { EmailStep } from './EmailStep.jsx';
import { OtpStep } from './OtpStep.jsx';
import styles from './LoginPage.module.css';

export function LoginPage() {
  const { setAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Where to go after successful auth — default to /dashboard
  const from = location.state?.from?.pathname || '/dashboard';

  // Guard against open-redirect (only allow internal paths)
  const safeFrom = from.startsWith('/') && !from.startsWith('//') ? from : '/dashboard';

  const {
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
  } = useEmailOtp();

  // Initiate Google OAuth — full browser navigation to backend
  const handleGoogleSignIn = () => {
    window.location.href = getGoogleAuthUrl();
  };

  const onVerify = async (otpValue) => {
    const result = await handleVerifyOtp(otpValue);
    if (result?.success && result.user) {
      setAuthenticated(result.user);
      navigate(safeFrom, { replace: true });
    }
  };

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        {/* Wordmark */}
        <div className={styles.logo}>
          <span className={styles.logoIcon} aria-hidden="true">◈</span>
          <span className={styles.logoText}>CodeAtlas</span>
        </div>

        {step === 'email' ? (
          <>
            <EmailStep
              onSubmit={handleRequestOtp}
              isLoading={isRequestingOtp}
              error={emailError || requestError}
              defaultEmail={email}
            />

            <div className={styles.divider} aria-hidden="true">
              <span>or</span>
            </div>

            {/* Google OAuth */}
            <Button
              type="button"
              variant="secondary"
              size="lg"
              fullWidth
              onClick={handleGoogleSignIn}
            >
              <GoogleIcon />
              Continue with Google
            </Button>
          </>
        ) : (
          <OtpStep
            email={email}
            onVerify={onVerify}
            onResend={handleResendOtp}
            onBack={goBackToEmail}
            isVerifying={isVerifyingOtp}
            isResending={isRequestingOtp}
            error={otpError || requestError}
            successMessage={successMessage}
          />
        )}

        <p className={styles.terms}>
          By signing in, you agree to CodeAtlas&apos;s terms of service and privacy policy.
        </p>
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
    </svg>
  );
}
