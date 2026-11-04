/**
 * ScanHistory — expandable scan history for a repository.
 *
 * Displays previous repository scans in descending chronological order,
 * with pagination, status badges, commit SHA, duration, and findings.
 * Supports reload via activeScanStatus and error recovery with Retry.
 */

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import styles from './ScanHistory.module.css';
import { getRepositoryScans } from '../../api/scans.js';
import { LoadingSpinner } from '../ui/LoadingSpinner.jsx';
import { Alert } from '../ui/Alert.jsx';
import { Button } from '../ui/Button.jsx';

const PAGE_SIZE = 5;

const STATUS_LABELS = {
  QUEUED: 'Queued',
  RUNNING: 'Running',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
};

function formatDuration(startedAt, completedAt) {
  if (!startedAt || !completedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;

  const diffMs = end - start;
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 1) return '< 1s';
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const remainingSecs = seconds % 60;
  if (remainingSecs === 0) return `${minutes}m`;
  return `${minutes}m ${remainingSecs}s`;
}

function formatCommitSha(sha) {
  if (!sha || typeof sha !== 'string') return null;
  return sha.slice(0, 7);
}

function formatDateTime(isoString) {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

export function ScanHistory({
  repositoryId,
  activeScanStatus,
  onStartAnalysis,
  canStartAnalysis = true,
}) {
  const [scans, setScans] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!repositoryId) return;

    let ignore = false;
    const controller = new AbortController();

    getRepositoryScans(
      repositoryId,
      { page, limit: PAGE_SIZE },
      controller.signal
    )
      .then((data) => {
        if (!ignore) {
          setScans(data.scans || []);
          setTotal(typeof data.total === 'number' ? data.total : (data.scans || []).length);
          setTotalPages(data.totalPages || 1);
          setError(null);
        }
      })
      .catch((err) => {
        if (ignore || err.name === 'AbortError') return;
        setError(err.message || 'Failed to load scan history.');
      })
      .finally(() => {
        if (!ignore) {
          setIsLoading(false);
        }
      });

    return () => {
      ignore = true;
      controller.abort();
    };
  }, [repositoryId, page, activeScanStatus, retryCount]);

  const handleRetry = useCallback(() => {
    setIsLoading(true);
    setError(null);
    setRetryCount((c) => c + 1);
  }, []);

  const handlePageChange = useCallback((newPage) => {
    setIsLoading(true);
    setError(null);
    setPage(newPage);
  }, []);

  if (!repositoryId) return null;

  return (
    <section className={styles.history} aria-label="Scan history">
      <div className={styles.header}>
        <h4 className={styles.title}>Scan History</h4>
        {total > 0 && (
          <span className={styles.count}>
            {total} {total === 1 ? 'scan' : 'scans'}
          </span>
        )}
      </div>

      {isLoading && (
        <div className={styles.loading}>
          <LoadingSpinner size="sm" label="Loading scan history…" />
        </div>
      )}

      {!isLoading && error && (
        <div className={styles.errorState}>
          <Alert variant="error">{error}</Alert>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRetry}
            className={styles.retryBtn}
          >
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !error && scans.length === 0 && (
        <div className={styles.empty}>
          <p className={styles.emptyMessage}>No previous scans yet.</p>
          <p className={styles.emptySubtext}>
            Run an analysis to inspect repository health and detect documentation drift.
          </p>
          {onStartAnalysis && canStartAnalysis && (
            <div className={styles.emptyAction}>
              <Button variant="secondary" size="sm" onClick={onStartAnalysis}>
                Run First Scan
              </Button>
            </div>
          )}
        </div>
      )}

      {!isLoading && !error && scans.length > 0 && (
        <>
          <ul className={styles.list} role="list">
            {scans.map((scan) => {
              const status = scan.status || 'QUEUED';
              const label = STATUS_LABELS[status] || status;
              const shortSha = formatCommitSha(scan.commitSha);
              const duration = formatDuration(scan.startedAt, scan.completedAt);
              const timestamp = formatDateTime(scan.createdAt || scan.startedAt);

              return (
                <li key={scan._id} className={styles.item}>
                  <div className={styles.itemTop}>
                    <div className={styles.badgeGroup}>
                      <span
                        className={`${styles.badge} ${styles[`badge--${status.toLowerCase()}`]}`}
                        role="status"
                      >
                        {status === 'RUNNING' && (
                          <LoadingSpinner size="sm" label="Running" />
                        )}
                        {label}
                      </span>
                      {shortSha && (
                        <span className={styles.commitSha} title={`Commit ${scan.commitSha}`}>
                          #{shortSha}
                        </span>
                      )}
                    </div>
                    <time className={styles.time} dateTime={scan.createdAt || scan.startedAt}>
                      {timestamp}
                    </time>
                  </div>

                  <div className={styles.metaRow}>
                    {scan.branch && (
                      <span className={styles.metaItem}>
                        <span className={styles.branch}>branch:</span> {scan.branch}
                      </span>
                    )}

                    {duration && (
                      <span className={styles.metaItem}>
                        <span className={styles.duration}>duration:</span> {duration}
                      </span>
                    )}

                    {status === 'COMPLETED' && typeof scan.filesScanned === 'number' && (
                      <span className={styles.metaItem}>
                        <span className={styles.findingsHighlight}>{scan.filesScanned}</span>{' '}
                        {scan.filesScanned === 1 ? 'file' : 'files'}
                      </span>
                    )}

                    {status === 'COMPLETED' && typeof scan.findingsCount === 'number' && (
                      <span className={styles.metaItem}>
                        <span className={styles.findingsHighlight}>{scan.findingsCount}</span>{' '}
                        {scan.findingsCount === 1 ? 'drift finding' : 'drift findings'}
                      </span>
                    )}
                  </div>

                  {status === 'FAILED' && scan.error && (
                    <p className={styles.errorBox}>{scan.error}</p>
                  )}

                  {status === 'COMPLETED' && (
                    <div className={styles.viewResultsRow}>
                      <Link
                        to={`/repositories/${repositoryId}/scans/${scan._id}/analysis`}
                        className={styles.viewResultsLink}
                      >
                        View Results →
                      </Link>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {totalPages > 1 && (
            <nav className={styles.pagination} aria-label="Scan history pagination">
              <span className={styles.pageInfo}>
                Page {page} of {totalPages}
              </span>
              <div className={styles.paginationActions}>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page <= 1 || isLoading}
                  onClick={() => handlePageChange(Math.max(1, page - 1))}
                  aria-label="Previous page"
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page >= totalPages || isLoading}
                  onClick={() => handlePageChange(Math.min(totalPages, page + 1))}
                  aria-label="Next page"
                >
                  Next
                </Button>
              </div>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
