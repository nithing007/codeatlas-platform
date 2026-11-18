/**
 * DashboardPage — Authenticated Repository Intelligence Overview.
 * Aggregates real metrics, repository overview, recent scan activity, and quick actions
 * using existing backend API services without mock or fabricated data.
 */

import { useState, useEffect, useCallback, useTransition } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { getRepositories } from '../api/repositories.js';
import { getRepositoryScans, createScan } from '../api/scans.js';
import { Button } from '../components/ui/Button.jsx';
import { Alert } from '../components/ui/Alert.jsx';
import { LoadingSpinner } from '../components/ui/LoadingSpinner.jsx';
import { ApiError } from '../api/client.js';
import styles from './DashboardPage.module.css';

export function DashboardPage() {
  const { user } = useAuth();
  const [, startTransition] = useTransition();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [repositories, setRepositories] = useState([]);
  const [repoScansMap, setRepoScansMap] = useState({});
  const [startingScanRepoId, setStartingScanRepoId] = useState(null);
  const [actionMessage, setActionMessage] = useState(null);

  const loadData = useCallback((signal) => {
    return getRepositories(signal)
      .then((repoRes) => {
        const repos = repoRes.repositories || [];
        setRepositories(repos);

        const scansMap = {};
        const scanPromises = repos.map((repo) =>
          getRepositoryScans(repo._id, { limit: 10 }, signal)
            .then((scanRes) => {
              scansMap[repo._id] = scanRes.scans || [];
            })
            .catch(() => {
              scansMap[repo._id] = [];
            })
        );

        return Promise.allSettled(scanPromises).then(() => {
          setRepoScansMap(scansMap);
        });
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError('Failed to load dashboard data. Please check your connection.');
        }
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadData(controller.signal);
    return () => controller.abort();
  }, [loadData]);

  const handleRefresh = useCallback(() => {
    setIsLoading(true);
    setError(null);
    loadData();
  }, [loadData]);

  // Compute actual metrics from fetched data
  const totalRepositories = repositories.length;

  let totalCompletedScans = 0;
  let activeScansCount = 0;
  let totalFindingsCount = 0;
  const recentActivities = [];

  repositories.forEach((repo) => {
    const scans = repoScansMap[repo._id] || [];
    scans.forEach((scan) => {
      if (scan.status === 'COMPLETED') {
        totalCompletedScans++;
        totalFindingsCount += scan.findingsCount || 0;
      } else if (scan.status === 'QUEUED' || scan.status === 'RUNNING') {
        activeScansCount++;
      }

      recentActivities.push({
        scanId: scan._id,
        repositoryId: repo._id,
        repositoryName: repo.fullName || repo.name,
        branch: scan.branch,
        commitSha: scan.commitSha,
        status: scan.status,
        findingsCount: scan.findingsCount || 0,
        filesScanned: scan.filesScanned || 0,
        createdAt: scan.createdAt,
        completedAt: scan.completedAt,
      });
    });
  });

  // Sort recent scans by createdAt descending
  recentActivities.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const topRecentActivities = recentActivities.slice(0, 8);

  const handleStartAnalysis = async (repositoryId) => {
    setStartingScanRepoId(repositoryId);
    setActionMessage(null);

    try {
      const result = await createScan(repositoryId);
      setActionMessage({
        type: 'success',
        text: `Analysis queued for scan ${result.scan._id.slice(-6)}.`,
      });

      // Optimistically update scans map
      startTransition(() => {
        setRepoScansMap((prev) => ({
          ...prev,
          [repositoryId]: [result.scan, ...(prev[repositoryId] || [])],
        }));
      });
    } catch (err) {
      setActionMessage({
        type: 'error',
        text: err instanceof ApiError && err.code === 'SCAN_ALREADY_IN_PROGRESS'
          ? 'A scan is already in progress for this repository.'
          : err.message || 'Failed to start analysis.',
      });
    } finally {
      setStartingScanRepoId(null);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        {/* ─── Header ─────────────────────────────────────────────────── */}
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <h1 className={styles.title}>Dashboard</h1>
            <p className={styles.subtitle}>
              Repository intelligence overview for{' '}
              <strong className={styles.userHighlight}>{user?.name || user?.email}</strong>
            </p>
          </div>

          <div className={styles.quickActions}>
            <Link to="/repositories">
              <Button variant="primary" size="md">
                + Import Repository
              </Button>
            </Link>
            <Button
              variant="secondary"
              size="md"
              onClick={handleRefresh}
              disabled={isLoading}
            >
              Refresh
            </Button>
          </div>
        </header>

        {actionMessage && (
          <div className={styles.alertWrapper}>
            <Alert variant={actionMessage.type}>
              {actionMessage.text}
            </Alert>
          </div>
        )}

        {error && (
          <div className={styles.alertWrapper}>
            <Alert variant="error">{error}</Alert>
          </div>
        )}

        {isLoading ? (
          <div className={styles.loadingContainer}>
            <LoadingSpinner label="Loading repository intelligence data..." />
          </div>
        ) : totalRepositories === 0 ? (
          /* ─── Empty State ───────────────────────────────────────────── */
          <div className={styles.emptyCard}>
            <span className={styles.emptyIcon}>◈</span>
            <h2 className={styles.emptyTitle}>No repositories imported yet</h2>
            <p className={styles.emptyDesc}>
              Import a public GitHub repository to begin static code analysis,
              detect documentation drift, and view repository intelligence metrics.
            </p>
            <div className={styles.emptyAction}>
              <Link to="/repositories">
                <Button variant="primary" size="lg">
                  Import Your First Repository &rarr;
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          <>
            {/* ─── Metric Cards ────────────────────────────────────────── */}
            <section className={styles.metricsGrid} aria-label="Repository Statistics">
              <div className={styles.metricCard}>
                <span className={styles.metricLabel}>Total Repositories</span>
                <span className={styles.metricValue}>{totalRepositories}</span>
                <span className={styles.metricSub}>Imported from GitHub</span>
              </div>

              <div className={styles.metricCard}>
                <span className={styles.metricLabel}>Completed Scans</span>
                <span className={styles.metricValue}>{totalCompletedScans}</span>
                <span className={styles.metricSub}>AST static analyses</span>
              </div>

              <div className={styles.metricCard}>
                <span className={styles.metricLabel}>In-Flight Scans</span>
                <span className={`${styles.metricValue} ${activeScansCount > 0 ? styles.metricActive : ''}`}>
                  {activeScansCount}
                </span>
                <span className={styles.metricSub}>
                  {activeScansCount > 0 ? 'Queue worker processing' : 'Queue idle'}
                </span>
              </div>

              <div className={styles.metricCard}>
                <span className={styles.metricLabel}>Detected Drift Findings</span>
                <span className={`${styles.metricValue} ${totalFindingsCount > 0 ? styles.metricAlert : ''}`}>
                  {totalFindingsCount}
                </span>
                <span className={styles.metricSub}>Documentation discrepancies</span>
              </div>
            </section>

            {/* ─── Main Content Grid ───────────────────────────────────── */}
            <div className={styles.contentGrid}>
              {/* Repository Overview Column */}
              <section className={styles.overviewSection}>
                <div className={styles.sectionTitleRow}>
                  <h2 className={styles.sectionHeading}>Repository Overview</h2>
                  <Link to="/repositories" className={styles.viewAllLink}>
                    View All ({totalRepositories}) &rarr;
                  </Link>
                </div>

                <div className={styles.repoCardsList}>
                  {repositories.map((repo) => {
                    const scans = repoScansMap[repo._id] || [];
                    const latestScan = scans[0];
                    const isStartingThis = startingScanRepoId === repo._id;
                    const isScanActive =
                      latestScan?.status === 'QUEUED' || latestScan?.status === 'RUNNING';

                    return (
                      <div key={repo._id} className={styles.repoOverviewCard}>
                        <div className={styles.repoCardHeader}>
                          <div>
                            <h3 className={styles.repoName}>
                              <Link to="/repositories">{repo.fullName || repo.name}</Link>
                            </h3>
                            <span className={styles.repoBranch}>
                              branch: <code>{repo.defaultBranch || 'main'}</code>
                            </span>
                          </div>

                          <div className={styles.repoBadgeGroup}>
                            {repo.language && (
                              <span className={styles.languageBadge}>{repo.language}</span>
                            )}
                            <span className={styles.visibilityBadge}>
                              {repo.visibility || 'public'}
                            </span>
                          </div>
                        </div>

                        <div className={styles.repoCardMeta}>
                          {latestScan ? (
                            <div className={styles.latestScanInfo}>
                              <span className={styles.scanStatusTag} data-status={latestScan.status}>
                                {latestScan.status}
                              </span>
                              <span className={styles.scanMetaText}>
                                {latestScan.status === 'COMPLETED' ? (
                                  <>
                                    <span>{latestScan.findingsCount || 0} findings</span>
                                    <span>·</span>
                                    <span>{formatDate(latestScan.completedAt || latestScan.createdAt)}</span>
                                  </>
                                ) : latestScan.status === 'FAILED' ? (
                                  <span>Failed · {formatDate(latestScan.createdAt)}</span>
                                ) : (
                                  <span>In Progress</span>
                                )}
                              </span>
                            </div>
                          ) : (
                            <span className={styles.noScansText}>No scans run yet</span>
                          )}
                        </div>

                        <div className={styles.repoCardActions}>
                          {latestScan && latestScan.status === 'COMPLETED' ? (
                            <Link
                              to={`/repositories/${repo._id}/scans/${latestScan._id}/analysis`}
                            >
                              <Button variant="ghost" size="sm">
                                View Analysis
                              </Button>
                            </Link>
                          ) : null}

                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={isScanActive || isStartingThis}
                            isLoading={isStartingThis}
                            onClick={() => handleStartAnalysis(repo._id)}
                          >
                            {isScanActive ? 'Scanning…' : 'Start Scan'}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Recent Activity Column */}
              <section className={styles.activitySection}>
                <div className={styles.sectionTitleRow}>
                  <h2 className={styles.sectionHeading}>Recent Scan Activity</h2>
                  <span className={styles.activityCount}>
                    {topRecentActivities.length} recent
                  </span>
                </div>

                {topRecentActivities.length === 0 ? (
                  <div className={styles.emptyActivity}>
                    <p>No scans recorded yet. Click &quot;Start Scan&quot; on any repository.</p>
                  </div>
                ) : (
                  <div className={styles.activityList}>
                    {topRecentActivities.map((act) => (
                      <div key={act.scanId} className={styles.activityItem}>
                        <div className={styles.activityLeft}>
                          <span
                            className={styles.statusDot}
                            data-status={act.status}
                            aria-hidden="true"
                          />
                          <div className={styles.activityInfo}>
                            <span className={styles.activityRepo}>{act.repositoryName}</span>
                            <span className={styles.activityMeta}>
                              <code>{act.branch}</code> · {formatDate(act.createdAt)}
                            </span>
                          </div>
                        </div>

                        <div className={styles.activityRight}>
                          {act.status === 'COMPLETED' ? (
                            <Link
                              to={`/repositories/${act.repositoryId}/scans/${act.scanId}/analysis`}
                              className={styles.viewResultLink}
                            >
                              <span className={styles.findingsPill}>
                                {act.findingsCount} findings
                              </span>
                            </Link>
                          ) : (
                            <span className={styles.activityStatusTag} data-status={act.status}>
                              {act.status}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
