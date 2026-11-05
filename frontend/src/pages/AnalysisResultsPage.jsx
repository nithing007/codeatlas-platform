/**
 * AnalysisResultsPage — displays persisted analysis results for a completed scan.
 *
 * Routes:
 *   /repositories/:repositoryId/scans/:scanId/analysis           — Full analysis dashboard
 *   /repositories/:repositoryId/scans/:scanId/analysis/findings  — Dedicated findings explorer
 *
 * Fetches the analysis result on mount.
 * Shows loading state, error state (with retry), and the result when available.
 */

import { useState, useEffect } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import { getScanAnalysis } from '../api/analysis.js';
import { LoadingSpinner } from '../components/ui/LoadingSpinner.jsx';
import { Alert } from '../components/ui/Alert.jsx';
import { Button } from '../components/ui/Button.jsx';
import { AnalysisOverview } from '../components/analysis/AnalysisOverview.jsx';
import { FactSummary } from '../components/analysis/FactSummary.jsx';
import { AnalysisWarnings } from '../components/analysis/AnalysisWarnings.jsx';
import { DriftSummary } from '../components/analysis/DriftSummary.jsx';
import { DriftFindingsExplorer } from '../components/analysis/DriftFindingsExplorer.jsx';
import styles from './AnalysisResultsPage.module.css';

export function AnalysisResultsPage({ isFindingsView = false }) {
  const { repositoryId, scanId } = useParams();
  const location = useLocation();

  const isFindings = isFindingsView || location.pathname.endsWith('/findings');

  const [analysis, setAnalysis] = useState(null);
  const [isLoading, setIsLoading] = useState(Boolean(repositoryId && scanId));
  const [error, setError] = useState(
    !repositoryId || !scanId ? 'Invalid URL: repository or scan ID is missing.' : null
  );
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!repositoryId || !scanId) return;

    let ignore = false;
    const controller = new AbortController();

    getScanAnalysis(repositoryId, scanId, controller.signal)
      .then((data) => {
        if (!ignore) {
          setAnalysis(data.analysis || null);
          setError(null);
        }
      })
      .catch((err) => {
        if (ignore || err.name === 'AbortError') return;
        setError(err.message || 'Failed to load analysis results.');
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
  }, [repositoryId, scanId, retryCount]);

  const handleRetry = () => {
    setIsLoading(true);
    setError(null);
    setRetryCount((c) => c + 1);
  };

  const overviewUrl = `/repositories/${repositoryId}/scans/${scanId}/analysis`;
  const findingsUrl = `/repositories/${repositoryId}/scans/${scanId}/analysis/findings`;

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        {/* Breadcrumb Navigation */}
        <nav className={styles.breadcrumb} aria-label="Breadcrumb">
          <Link to="/repositories" className={styles.breadcrumbLink}>
            Repositories
          </Link>
          <span className={styles.breadcrumbSep} aria-hidden="true">›</span>
          <Link
            to={`/repositories/${repositoryId}`}
            className={styles.breadcrumbLink}
          >
            Repository
          </Link>
          <span className={styles.breadcrumbSep} aria-hidden="true">›</span>

          {isFindings ? (
            <>
              <Link to={overviewUrl} className={styles.breadcrumbLink}>
                Analysis Results
              </Link>
              <span className={styles.breadcrumbSep} aria-hidden="true">›</span>
              <span className={styles.breadcrumbCurrent}>Drift Findings</span>
            </>
          ) : (
            <span className={styles.breadcrumbCurrent}>Analysis Results</span>
          )}
        </nav>

        <header className={styles.header}>
          <div className={styles.headerTitleRow}>
            <h1 className={styles.title}>
              {isFindings ? 'Drift Findings' : 'Analysis Results'}
            </h1>
            {isFindings && (
              <Link to={overviewUrl} className={styles.backLink}>
                ← Back to Overview
              </Link>
            )}
          </div>

          {!isLoading && !error && analysis && (
            <p className={styles.subtitle}>
              Scan <span className={styles.scanId}>{scanId.slice(0, 8)}</span>
              {isFindings
                ? ' individual documentation drift findings.'
                : ' completed successfully.'}
            </p>
          )}
        </header>

        {isLoading && (
          <div className={styles.loadingState}>
            <LoadingSpinner label="Loading analysis results…" />
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

        {!isLoading && !error && analysis && (
          <div className={styles.content}>
            {isFindings ? (
              /* Dedicated Findings View */
              <section className={styles.section} id="drift-findings">
                <DriftFindingsExplorer
                  findings={analysis.drift?.findings}
                  summary={analysis.drift?.summary}
                />
              </section>
            ) : (
              /* Full Dashboard View */
              <>
                <section className={styles.section}>
                  <AnalysisOverview scan={null} result={analysis} />
                </section>

                <section className={styles.section} id="drift-summary">
                  <DriftSummary
                    drift={analysis.drift}
                    exploreHref={findingsUrl}
                  />
                </section>

                <section className={styles.section} id="drift-findings">
                  <DriftFindingsExplorer
                    findings={analysis.drift?.findings}
                    summary={analysis.drift?.summary}
                  />
                </section>

                <section className={styles.section}>
                  <FactSummary facts={analysis.facts} />
                </section>

                {Array.isArray(analysis.warnings) && (
                  <section className={styles.section}>
                    <AnalysisWarnings warnings={analysis.warnings} />
                  </section>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
