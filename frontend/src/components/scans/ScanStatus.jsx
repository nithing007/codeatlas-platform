/**
 * ScanStatus — displays the current status of a repository analysis scan.
 *
 * Shows:
 *  QUEUED    → waiting badge + descriptive message
 *  RUNNING   → running badge + spinner + in-progress message
 *  COMPLETED → success badge + files and findings summary
 *  FAILED    → error badge + sanitized error message from backend
 *
 * The `scan.error` field is already sanitized by the backend (no stack traces).
 * This component never displays invented progress percentages or ETAs.
 */

import styles from './ScanStatus.module.css';
import { LoadingSpinner } from '../ui/LoadingSpinner.jsx';

const STATUS_LABELS = {
  QUEUED: 'Queued',
  RUNNING: 'Running',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
};

export function ScanStatus({ scan }) {
  if (!scan) return null;

  const { status, error, filesScanned, findingsCount, startedAt, completedAt } = scan;
  const label = STATUS_LABELS[status] || status;

  return (
    <div
      className={`${styles.container} ${styles[`container--${status?.toLowerCase()}`]}`}
      role="status"
      aria-label={`Scan status: ${label}`}
    >
      <div className={styles.headerRow}>
        <span className={`${styles.badge} ${styles[`badge--${status?.toLowerCase()}`]}`}>
          {status === 'RUNNING' && (
            <LoadingSpinner size="sm" label="Scan in progress" />
          )}
          {label}
        </span>

        {status === 'COMPLETED' && completedAt && (
          <span className={styles.timestamp}>
            Completed{' '}
            {new Date(completedAt).toLocaleTimeString(undefined, {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        )}
        {status === 'RUNNING' && startedAt && (
          <span className={styles.timestamp}>
            Started{' '}
            {new Date(startedAt).toLocaleTimeString(undefined, {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        )}
      </div>

      {status === 'QUEUED' && (
        <p className={styles.message}>Waiting for analysis worker.</p>
      )}

      {status === 'RUNNING' && (
        <p className={styles.message}>Repository analysis is in progress.</p>
      )}

      {status === 'COMPLETED' && (
        <div className={styles.results}>
          <span className={styles.resultItem}>
            <strong>{typeof filesScanned === 'number' ? filesScanned : 0}</strong>{' '}
            {filesScanned === 1 ? 'file' : 'files'} scanned
          </span>
          {typeof findingsCount === 'number' && findingsCount > 0 && (
            <span className={styles.resultItem}>
              <strong>{findingsCount}</strong>{' '}
              {findingsCount === 1 ? 'finding' : 'findings'}
            </span>
          )}
          {typeof findingsCount === 'number' && findingsCount === 0 && (
            <span className={styles.resultItem}>No drift findings.</span>
          )}
        </div>
      )}

      {status === 'FAILED' && (
        <p className={styles.errorMessage}>
          {error || 'The scan encountered an error. Please try again.'}
        </p>
      )}
    </div>
  );
}

