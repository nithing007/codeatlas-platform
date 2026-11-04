/**
 * RepositoryCard component.
 * Displays repository metadata returned by backend:
 * name, owner/fullName, description, GitHub URL, default branch,
 * language, visibility, stars, forks, and creation date.
 *
 * Also integrates scan execution, live scan status polling,
 * and expandable scan history.
 */

import { useState, useCallback } from 'react';
import styles from './RepositoryCard.module.css';
import { Button } from '../ui/Button.jsx';
import { Alert } from '../ui/Alert.jsx';
import { ScanStatus } from '../scans/ScanStatus.jsx';
import { ScanHistory } from '../scans/ScanHistory.jsx';
import { useScanPolling } from '../../hooks/useScanPolling.js';
import { createScan } from '../../api/scans.js';
import { ApiError } from '../../api/client.js';

export function RepositoryCard({ repository }) {
  // All hooks must be called unconditionally — before the early-return guard.
  // useScanPolling handles undefined repositoryId gracefully.
  const repositoryId = repository?._id;
  const { scan, isPolling, pollingError, startPolling } = useScanPolling(repositoryId);
  const [isStarting, setIsStarting] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const handleStartAnalysis = useCallback(async () => {
    if (isStarting || isPolling) return;

    setIsStarting(true);
    setCreateError(null);

    try {
      const data = await createScan(repositoryId);
      startPolling(data.scan._id, data.scan);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SCAN_ALREADY_IN_PROGRESS') {
        setCreateError('A scan is already in progress for this repository.');
      } else {
        setCreateError(err.message || 'Failed to start analysis. Please try again.');
      }
    } finally {
      setIsStarting(false);
    }
  }, [isStarting, isPolling, repositoryId, startPolling]);

  // Early return AFTER all hooks
  if (!repository) return null;

  const {
    name,
    fullName,
    description,
    htmlUrl,
    defaultBranch = 'main',
    visibility = 'public',
    language,
    stars = 0,
    forks = 0,
    createdAt,
  } = repository;

  const formattedDate = createdAt
    ? new Date(createdAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;

  // Hide the Start Analysis button while a scan is actively running
  const isActive = isPolling || scan?.status === 'QUEUED' || scan?.status === 'RUNNING';

  return (
    <article className={styles.card} aria-label={`Repository ${fullName || name}`}>
      <header className={styles.header}>
        <div className={styles.titleArea}>
          <h3 className={styles.repoName}>
            {htmlUrl ? (
              <a
                href={htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.repoLink}
                aria-label={`${fullName || name} on GitHub (opens in new tab)`}
              >
                <span>{fullName || name}</span>
                <svg
                  className={styles.externalIcon}
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M12 8.667v4.666a1.333 1.333 0 0 1-1.333 1.334H3.333A1.333 1.333 0 0 1 2 13.333V6a1.333 1.333 0 0 1 1.333-1.333h4.667M10 2h4v4M6.667 9.333 14 2"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </a>
            ) : (
              <span>{fullName || name}</span>
            )}
          </h3>
        </div>

        <div className={styles.badgeGroup}>
          <span className={`${styles.badge} ${styles.badgePublic}`}>
            {visibility}
          </span>
        </div>
      </header>

      <p className={styles.description}>
        {description ? (
          description
        ) : (
          <span className={styles.noDescription}>No description provided.</span>
        )}
      </p>

      <div className={styles.metaRow}>
        {language && (
          <span className={styles.metaItem}>
            <span className={styles.languageDot} aria-hidden="true" />
            <span>{language}</span>
          </span>
        )}

        <span className={styles.metaItem} title="Default branch">
          <svg
            className={styles.metaIcon}
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M4 11.333a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM12 4.667a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM4 4v3.333a4 4 0 0 0 4 4h4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>{defaultBranch}</span>
        </span>

        {typeof stars === 'number' && (
          <span className={styles.metaItem} title="GitHub stars">
            <svg
              className={styles.metaIcon}
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M8 .667 10.27 5.27 15.333 6l-3.666 3.573.866 5.094L8 12.267l-4.533 2.4.866-5.094L.667 6l5.066-.733L8 .667Z"
                fill="currentColor"
              />
            </svg>
            <span>{stars.toLocaleString()}</span>
          </span>
        )}

        {typeof forks === 'number' && (
          <span className={styles.metaItem} title="GitHub forks">
            <svg
              className={styles.metaIcon}
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M4 4.667a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM12 4.667a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM8 15.333a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM4 4.667v2a4 4 0 0 0 4 4v.666M12 4.667v2a4 4 0 0 1-4 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>{forks.toLocaleString()}</span>
          </span>
        )}

        {formattedDate && (
          <span className={styles.footer}>
            Imported {formattedDate}
          </span>
        )}
      </div>

      {/* ── Scan section ───────────────────────────────────────── */}
      <div className={styles.scanSection}>
        {createError && (
          <Alert variant="error">{createError}</Alert>
        )}

        {pollingError && !createError && (
          <Alert variant="warning">{pollingError}</Alert>
        )}

        {scan && <ScanStatus scan={scan} />}

        <div className={styles.scanActions}>
          {!isActive && (
            <Button
              variant="primary"
              size="sm"
              isLoading={isStarting}
              onClick={handleStartAnalysis}
              aria-label={`Start analysis for ${fullName || name}`}
            >
              Start Analysis
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsHistoryOpen((open) => !open)}
            aria-expanded={isHistoryOpen}
            aria-controls={`scan-history-${repositoryId}`}
          >
            {isHistoryOpen ? 'Hide History' : 'Scan History'}
          </Button>
        </div>

        {isHistoryOpen && (
          <div id={`scan-history-${repositoryId}`}>
            <ScanHistory
              key={repositoryId}
              repositoryId={repositoryId}
              activeScanStatus={scan?.status}
              onStartAnalysis={handleStartAnalysis}
              canStartAnalysis={!isActive}
            />
          </div>
        )}
      </div>
    </article>
  );
}
