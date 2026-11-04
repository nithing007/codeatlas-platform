/**
 * AnalysisWarnings — displays non-fatal analyzer warnings.
 *
 * Props:
 *   warnings  {string[]}  result.warnings — array of warning message strings.
 */

import styles from './AnalysisWarnings.module.css';

export function AnalysisWarnings({ warnings }) {
  const list = Array.isArray(warnings) ? warnings : [];

  if (list.length === 0) {
    return (
      <section className={styles.warnings} aria-label="Analysis warnings">
        <h2 className={styles.sectionTitle}>
          Warnings
          <span className={styles.countBadge}>0</span>
        </h2>
        <p className={styles.emptyNote}>No warnings were produced during analysis.</p>
      </section>
    );
  }

  return (
    <section className={styles.warnings} aria-label="Analysis warnings">
      <h2 className={styles.sectionTitle}>
        Warnings
        <span className={styles.countBadge}>{list.length}</span>
      </h2>
      <ul className={styles.list} role="list">
        {list.map((warning, idx) => (
          // eslint-disable-next-line react/no-array-index-key
          <li key={idx} className={styles.item}>
            <span className={styles.icon} aria-hidden="true">⚠</span>
            <span className={styles.message}>
              {typeof warning === 'string' ? warning : 'An unexpected warning occurred.'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

