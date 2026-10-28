/**
 * Landing page — public entry point for CodeAtlas.
 */

import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Button } from '../components/ui/Button.jsx';
import styles from './LandingPage.module.css';

export function LandingPage() {
  const { isAuthenticated } = useAuth();

  return (
    <main className={styles.main}>
      <section className={styles.hero}>
        <div className={styles.badge}>Repository Intelligence Platform</div>

        <h1 className={styles.headline}>
          Understand your codebase.
          <br />
          <span className={styles.accent}>Detect documentation drift.</span>
        </h1>

        <p className={styles.subheadline}>
          CodeAtlas analyses your repositories and surfaces stale documentation,
          missing comments, and knowledge gaps — automatically.
        </p>

        <div className={styles.cta}>
          {isAuthenticated ? (
            <Button as={Link} to="/dashboard" variant="primary" size="lg">
              Go to Dashboard
            </Button>
          ) : (
            <>
              <Link to="/login">
                <Button variant="primary" size="lg">Get started free</Button>
              </Link>
              <Link to="/login" className={styles.secondaryCta}>
                Sign in
              </Link>
            </>
          )}
        </div>

        <div className={styles.features}>
          {FEATURES.map((f) => (
            <div key={f.title} className={styles.featureCard}>
              <span className={styles.featureIcon} aria-hidden="true">{f.icon}</span>
              <h3 className={styles.featureTitle}>{f.title}</h3>
              <p className={styles.featureDesc}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

const FEATURES = [
  {
    icon: '⬡',
    title: 'Static Analysis',
    desc: 'Deep parse of your repository structure, functions, classes, and modules.',
  },
  {
    icon: '⟳',
    title: 'Drift Detection',
    desc: 'Compares code evolution against documentation to find what fell out of sync.',
  },
  {
    icon: '◈',
    title: 'Async Scanning',
    desc: 'Scans run in the background — check results any time without blocking your flow.',
  },
];

