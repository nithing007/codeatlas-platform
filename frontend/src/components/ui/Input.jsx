/**
 * Reusable Input component with label, error state, and accessible attributes.
 */

import { useId } from 'react';
import styles from './Input.module.css';

export function Input({
  label,
  error,
  hint,
  type = 'text',
  required = false,
  disabled = false,
  className = '',
  inputClassName = '',
  id: providedId,
  ...rest
}) {
  const generatedId = useId();
  const id = providedId || generatedId;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  const describedBy = [
    error ? errorId : null,
    hint ? hintId : null,
  ]
    .filter(Boolean)
    .join(' ') || undefined;

  return (
    <div className={`${styles.field} ${className}`}>
      {label && (
        <label htmlFor={id} className={styles.label}>
          {label}
          {required && <span className={styles.required} aria-hidden="true"> *</span>}
        </label>
      )}
      <input
        id={id}
        type={type}
        className={[
          styles.input,
          error ? styles['input--error'] : '',
          inputClassName,
        ]
          .filter(Boolean)
          .join(' ')}
        disabled={disabled}
        required={required}
        aria-required={required}
        aria-invalid={!!error}
        aria-describedby={describedBy}
        {...rest}
      />
      {hint && !error && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className={styles.error} role="alert" aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
}

