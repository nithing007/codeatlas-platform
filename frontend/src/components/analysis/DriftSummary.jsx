/**
 * DriftSummary — displays aggregate drift detection counts.
 * Shows total, high, medium, and low severity finding counts.
 * Does NOT display individual findings (Phase 6D).
 *
 * Props:
 *   drift  {object}  result.drift — { summary: { total, high, medium, low }, findings: [] }
 */

import styles from './DriftSummary.module.css';

function SeverityCard({ label, count, variant }) {
  return (
    <div className={`${styles.card} ${styles[`card--${variant}`]}`}>
      <span className={styles.cardCount}>{typeof count === 'number' ? count : 0}</span>
      <span className={styles.cardLabel}>{label}</span>
    </div>
  );
}

export function DriftSummary({ drift }) {
  const summary = drift?.summary || {};
  const total = typeof summary.total === 'number' ? summary.total : 0;
  const high = typeof summary.high === 'number' ? summary.high : 0;
  const medium = typeof summary.medium === 'number' ? summary.medium : 0;
  const low = typeof summary.low === 'number' ? summary.low : 0;

  return (
    <section className={styles.driftSummary} aria-label="Drift summary">
      <h2 className={styles.sectionTitle}>Documentation Drift</h2>

      {total === 0 ? (
        <p className={styles.noFindings}>No documentation drift detected. Documentation is in sync.</p>
      ) : (
        <p className={styles.findingsNote}>
          <strong className={styles.findingsCount}>{total}</strong>{' '}
          {total === 1 ? 'drift finding' : 'drift findings'} detected.
        </p>
      )}

      <div className={styles.cardGrid}>
        <SeverityCard label="Total" count={total} variant="total" />
        <SeverityCard label="High" count={high} variant="high" />
        <SeverityCard label="Medium" count={medium} variant="medium" />
        <SeverityCard label="Low" count={low} variant="low" />
      </div>
    </section>
  );
}

