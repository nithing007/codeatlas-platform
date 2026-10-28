/**
 * Loading spinner — full-screen centered or inline.
 */

import styles from './LoadingSpinner.module.css';

export function LoadingSpinner({ fullPage = false, size = 'md', label = 'Loading…' }) {
  const spinner = (
    <div
      className={`${styles.spinner} ${styles[`spinner--${size}`]}`}
      role="status"
      aria-label={label}
    >
      <span className="sr-only">{label}</span>
    </div>
  );

  if (fullPage) {
    return <div className={styles.overlay}>{spinner}</div>;
  }
  return spinner;
}

