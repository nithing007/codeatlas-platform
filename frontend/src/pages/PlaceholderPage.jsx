/**
 * Placeholder pages for protected routes not yet implemented (Phase 6B+).
 * Clearly marked as coming soon — no fake data.
 */

import styles from './PlaceholderPage.module.css';

export function RepositoriesPage() {
  return (
    <PlaceholderPage
      title="Repositories"
      desc="Repository management will be available in Phase 6B."
    />
  );
}

export function RepositoryDetailPage() {
  return (
    <PlaceholderPage
      title="Repository"
      desc="Repository details will be available in Phase 6B."
    />
  );
}

export function ScanDetailPage() {
  return (
    <PlaceholderPage
      title="Scan Results"
      desc="Scan result views will be available in Phase 6C."
    />
  );
}

function PlaceholderPage({ title, desc }) {
  return (
    <main className={styles.main}>
      <div className={styles.content}>
        <span className={styles.icon} aria-hidden="true">◈</span>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.desc}>{desc}</p>
      </div>
    </main>
  );
}

