/**
 * Dashboard — protected placeholder for Phase 6B+.
 * Shows authenticated user info. No fake data.
 */

import { useAuth } from '../context/AuthContext.jsx';
import styles from './DashboardPage.module.css';

export function DashboardPage() {
  const { user } = useAuth();

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <header className={styles.header}>
          <h1 className={styles.title}>Dashboard</h1>
          <p className={styles.subtitle}>
            Welcome back{user?.name ? `, ${user.name}` : ''}!
          </p>
        </header>

        <div className={styles.placeholder}>
          <span className={styles.placeholderIcon} aria-hidden="true">◈</span>
          <h2 className={styles.placeholderTitle}>Dashboard coming in Phase 6B</h2>
          <p className={styles.placeholderDesc}>
            Repository listing, scan management, and analysis results will appear here.
            Your session is active and authenticated.
          </p>
          <div className={styles.sessionInfo}>
            <p><span className={styles.label}>Email:</span> {user?.email}</p>
            {user?.role && (
              <p><span className={styles.label}>Role:</span> {user.role}</p>
            )}
            {user?.authProvider && (
              <p><span className={styles.label}>Auth:</span> {user.authProvider}</p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

