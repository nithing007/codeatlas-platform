/**
 * Reusable Button component.
 * Supports primary, secondary, ghost, and danger variants.
 * Displays a spinner when loading and prevents double-submission.
 */

import styles from './Button.module.css';

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  disabled = false,
  type = 'button',
  fullWidth = false,
  className = '',
  ...rest
}) {
  const classes = [
    styles.btn,
    styles[`btn--${variant}`],
    styles[`btn--${size}`],
    fullWidth ? styles['btn--full'] : '',
    isLoading ? styles['btn--loading'] : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || isLoading}
      aria-busy={isLoading}
      {...rest}
    >
      {isLoading && (
        <span className={styles.spinner} aria-hidden="true" />
      )}
      <span className={isLoading ? styles.btnText : undefined}>{children}</span>
    </button>
  );
}

