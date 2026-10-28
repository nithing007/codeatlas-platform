/**
 * OTP verification step.
 */

import { useState } from 'react';
import { Input } from '../../components/ui/Input.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Alert } from '../../components/ui/Alert.jsx';
import styles from './LoginPage.module.css';

export function OtpStep({
  email,
  onVerify,
  onResend,
  onBack,
  isVerifying,
  isResending,
  error,
  successMessage,
}) {
  const [otp, setOtp] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    onVerify(otp);
  };

  const handleOtpChange = (e) => {
    // Allow only digits, max 6
    const val = e.target.value.replace(/\D/g, '').slice(0, 6);
    setOtp(val);
  };

  return (
    <form onSubmit={handleSubmit} noValidate aria-label="Verify code">
      <div className={styles.stepHeader}>
        <h2 className={styles.stepTitle}>Check your email</h2>
        <p className={styles.stepDesc}>
          We sent a 6-digit code to{' '}
          <strong className={styles.emailHighlight}>{email}</strong>.
          Enter it below to sign in.
        </p>
      </div>

      {successMessage && !error && (
        <Alert variant="success">{successMessage}</Alert>
      )}
      {error && <Alert variant="error">{error}</Alert>}

      <div className={styles.fields}>
        <Input
          label="Verification code"
          type="text"
          id="otp"
          value={otp}
          onChange={handleOtpChange}
          placeholder="000000"
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="\d{6}"
          autoFocus
          required
          disabled={isVerifying}
          hint="The code expires in 5 minutes."
        />
      </div>

      <Button
        type="submit"
        variant="primary"
        size="lg"
        fullWidth
        isLoading={isVerifying}
        disabled={isVerifying || isResending || otp.length !== 6}
      >
        Verify and sign in
      </Button>

      <div className={styles.otpActions}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onResend}
          isLoading={isResending}
          disabled={isResending || isVerifying}
        >
          Resend code
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBack}
          disabled={isVerifying || isResending}
        >
          ← Change email
        </Button>
      </div>
    </form>
  );
}
