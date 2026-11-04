/**
 * AnalysisOverview — scan metadata and file count summary.
 *
 * Props:
 *   scan    {object}  Scan object (status, commitSha, branch, startedAt, completedAt)
 *   result  {object}  AnalysisResult object (analyzerVersion, fileCounts, createdAt)
 */

import styles from './AnalysisOverview.module.css';

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
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

function formatDuration(startedAt, completedAt) {
  if (!startedAt || !completedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  const seconds = Math.floor((end - start) / 1000);
  if (seconds < 1) return '< 1s';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSecs = seconds % 60;
  return remainingSecs === 0 ? `${minutes}m` : `${minutes}m ${remainingSecs}s`;
}

function MetaRow({ label, value, mono = false }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className={styles.metaRow}>
      <span className={styles.metaLabel}>{label}</span>
      <span className={mono ? styles.metaValueMono : styles.metaValue}>{value}</span>
    </div>
  );
}

function FileCountCard({ label, count }) {
  if (typeof count !== 'number') return null;
  return (
    <div className={styles.fileCard}>
      <span className={styles.fileCount}>{count}</span>
      <span className={styles.fileLabel}>{label}</span>
    </div>
  );
}

export function AnalysisOverview({ scan, result }) {
  const shortSha = formatCommitSha(scan?.commitSha || result?.commitSha);
  const fullSha = scan?.commitSha || result?.commitSha || null;
  const branch = scan?.branch || result?.branch || null;
  const completedAt = scan?.completedAt || null;
  const startedAt = scan?.startedAt || null;
  const duration = formatDuration(startedAt, completedAt);
  const analyzedAt = formatDateTime(result?.createdAt || completedAt);
  const analyzerVersion = result?.analyzerVersion || null;

  const fileCounts = result?.fileCounts || {};

  return (
    <section className={styles.overview} aria-label="Analysis overview">
      <div className={styles.metaSection}>
        <h2 className={styles.sectionTitle}>Scan Details</h2>
        <div className={styles.metaGrid}>
          {branch && <MetaRow label="Branch" value={branch} />}
          {shortSha && (
            <MetaRow
              label="Commit"
              value={shortSha}
              mono
            />
          )}
          {fullSha && fullSha !== shortSha && (
            <MetaRow label="Full SHA" value={fullSha} mono />
          )}
          <MetaRow label="Analyzed" value={analyzedAt} />
          {duration && <MetaRow label="Duration" value={duration} />}
          {analyzerVersion && <MetaRow label="Analyzer" value={`v${analyzerVersion}`} />}
        </div>
      </div>

      {typeof fileCounts.total === 'number' && (
        <div className={styles.fileSection}>
          <h2 className={styles.sectionTitle}>Files Analyzed</h2>
          <div className={styles.fileGrid}>
            <FileCountCard label="Total" count={fileCounts.total} />
            <FileCountCard label="Source" count={fileCounts.source} />
            <FileCountCard label="Docs" count={fileCounts.documentation} />
            <FileCountCard label="Config" count={fileCounts.configuration} />
            {typeof fileCounts.infrastructure === 'number' && fileCounts.infrastructure > 0 && (
              <FileCountCard label="Infra" count={fileCounts.infrastructure} />
            )}
            {typeof fileCounts.other === 'number' && fileCounts.other > 0 && (
              <FileCountCard label="Other" count={fileCounts.other} />
            )}
          </div>
        </div>
      )}
    </section>
  );
}

