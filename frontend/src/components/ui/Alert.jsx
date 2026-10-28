/**
 * Alert — displays error, success, warning, or info messages.
 * Uses role="alert" for live announcements.
 */

import styles from './Alert.module.css';

const ICONS = {
  error: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 1.333A6.667 6.667 0 1 0 8 14.667 6.667 6.667 0 0 0 8 1.333Zm0 3.334a.667.667 0 0 1 .667.666v2.667a.667.667 0 0 1-1.334 0V5.333A.667.667 0 0 1 8 4.667Zm0 6a.833.833 0 1 1 0-1.667.833.833 0 0 1 0 1.667Z" fill="currentColor"/>
    </svg>
  ),
  success: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 1.333A6.667 6.667 0 1 0 8 14.667 6.667 6.667 0 0 0 8 1.333ZM6.667 11.057 3.61 8 4.553 7.057l2.114 2.113 4.447-4.447.943.943-5.39 5.391Z" fill="currentColor"/>
    </svg>
  ),
  warning: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8.943 1.667a1.083 1.083 0 0 0-1.886 0L1.19 11.333A1.083 1.083 0 0 0 2.133 13h11.734a1.083 1.083 0 0 0 .943-1.667L8.943 1.667ZM8 5.333a.667.667 0 0 1 .667.667v2.667a.667.667 0 1 1-1.334 0V6A.667.667 0 0 1 8 5.333Zm0 6a.833.833 0 1 1 0-1.667.833.833 0 0 1 0 1.667Z" fill="currentColor"/>
    </svg>
  ),
  info: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 1.333A6.667 6.667 0 1 0 8 14.667 6.667 6.667 0 0 0 8 1.333ZM8 4.667a.833.833 0 1 1 0 1.667.833.833 0 0 1 0-1.667Zm1.333 6.666H6.667a.667.667 0 0 1 0-1.333h.666V8h-.666a.667.667 0 0 1 0-1.333H8a.667.667 0 0 1 .667.666V10h.666a.667.667 0 0 1 0 1.333Z" fill="currentColor"/>
    </svg>
  ),
};

export function Alert({ variant = 'error', children, className = '' }) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className={`${styles.alert} ${styles[`alert--${variant}`]} ${className}`}
    >
      <span className={styles.icon}>{ICONS[variant]}</span>
      <span className={styles.content}>{children}</span>
    </div>
  );
}

