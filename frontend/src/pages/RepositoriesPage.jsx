/**
 * RepositoriesPage — protected repository management page.
 * Allows viewing imported GitHub repositories and adding new ones.
 */

import { useCallback, useEffect, useState } from 'react';
import { getRepositories } from '../api/repositories.js';
import { ApiError } from '../api/client.js';
import { AddRepositoryForm } from '../components/repositories/AddRepositoryForm.jsx';
import { RepositoryList } from '../components/repositories/RepositoryList.jsx';
import styles from './RepositoriesPage.module.css';

export function RepositoriesPage() {
  const [repositories, setRepositories] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const handleRetry = useCallback(() => {
    setIsLoading(true);
    setError(null);
    getRepositories()
      .then((data) => {
        setRepositories(data.repositories || []);
        setError(null);
      })
      .catch((err) => {
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError('Failed to load repositories. Please check your connection.');
        }
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    getRepositories(controller.signal)
      .then((data) => {
        setRepositories(data.repositories || []);
        setError(null);
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError('Failed to load repositories. Please check your connection.');
        }
      })
      .finally(() => {
        setIsLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, []);

  const handleRepositoryAdded = useCallback((newRepo) => {
    setRepositories((prev) => {
      const existingId = newRepo._id || newRepo.githubRepositoryId || newRepo.fullName;
      const filtered = prev.filter(
        (r) => (r._id || r.githubRepositoryId || r.fullName) !== existingId
      );
      return [newRepo, ...filtered];
    });
  }, []);

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <header className={styles.header}>
          <h1 className={styles.title}>Repositories</h1>
          <p className={styles.subtitle}>
            Manage public GitHub repositories imported for documentation drift detection.
          </p>
        </header>

        <AddRepositoryForm onRepositoryAdded={handleRepositoryAdded} />

        <RepositoryList
          repositories={repositories}
          isLoading={isLoading}
          error={error}
          onRetry={handleRetry}
        />
      </div>
    </main>
  );
}
