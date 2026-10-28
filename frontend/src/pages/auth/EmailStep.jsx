/**
 * Email OTP step — email entry form.
 */

import { useRef, useState } from 'react';
import { Input } from '../../components/ui/Input.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Alert } from '../../components/ui/Alert.jsx';
import styles from './LoginPage.module.css';

export function EmailStep({ onSubmit, isLoading, error, defaultEmail = '' }) {
  const [email, setEmail] = useState(defaultEmail);
  const inputRef = useRef(null);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(email);
  };

  return (
    <form onSubmit={handleSubmit} noValidate aria-label="Request verification code">
      <div className={styles.stepHeader}>
        <h2 className={styles.stepTitle}>Sign in to CodeAtlas</h2>
        <p className={styles.stepDesc}>
          Enter your email address and we&apos;ll send you a one-time verification code.
        </p>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      <div className={styles.fields}>
        <Input
          ref={inputRef}
          label="Email address"
          type="email"
          id="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          autoFocus
          required
          disabled={isLoading}
        />
      </div>

      <Button
        type="submit"
        variant="primary"
        size="lg"
        fullWidth
        isLoading={isLoading}
        disabled={isLoading}
      >
        Send verification code
      </Button>
    </form>
  );
}

