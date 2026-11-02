/**
 * RepositoryList component.
 * Handles rendering states for user repositories:
 * - Loading spinner while data is being fetched
 * - Error message with retry option on failure
 * - Empty state with helpful prompt when count is 0
 * - RepositoryCard grid when repositories are present
 */

import { RepositoryCard } from './RepositoryCard.jsx';
import { LoadingSpinner } from '../ui/LoadingSpinner.jsx';
import { Alert } from '../ui/Alert.jsx';
import { Button } from '../ui/Button.jsx';
import styles from './RepositoryList.module.css';

export function RepositoryList({
  repositories = [],
  isLoading = false,
  error = null,
  onRetry,
}) {
  if (isLoading) {
    return (
      <div className={styles.loadingState}>
        <LoadingSpinner size="lg" label="Loading repositories…" />
        <p aria-hidden="true">Loading repositories…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.errorState}>
        <Alert variant="error" role="alert">
          {error}
        </Alert>
        {onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    );
  }

  if (!repositories || repositories.length === 0) {
    return (
      <section className={styles.emptyState} aria-label="No repositories">
        <span className={styles.emptyIcon} aria-hidden="true">
          ◈
        </span>
        <h3 className={styles.emptyTitle}>No repositories added yet</h3>
        <p className={styles.emptyDesc}>
          Import a public GitHub repository above to start managing your codebases and detecting documentation drift.
        </p>
      </section>
    );
  }

  return (
    <section className={styles.container} aria-labelledby="repositories-heading">
      <div className={styles.headerRow}>
        <h2 id="repositories-heading" className={styles.title}>
          <span>Your Repositories</span>
          <span className={styles.countBadge} aria-label={`${repositories.length} repositories`}>
            {repositories.length}
          </span>
        </h2>
      </div>

      <div className={styles.grid}>
        {repositories.map((repo) => (
          <RepositoryCard
            key={repo._id || repo.githubRepositoryId || repo.fullName}
            repository={repo}
          />
        ))}
      </div>
    </section>
  );
}
